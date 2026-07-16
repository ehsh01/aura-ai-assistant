import bcrypt from "bcryptjs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { users } from "@workspace/db/schema";
import { getDb, isDatabaseConfigured } from "../lib/db";
import { config } from "../lib/config";
import { ensureDefaultConnectors } from "./connectors";
import { createAuthSession, revokeAllAuthSessionsForUser } from "./auth-sessions";

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = process.env.JWT_EXPIRES_IN ?? "7d";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface AuthTokenPayload {
  sub: string;
  email: string;
  name: string;
  /** Session id — must match an active auth_sessions row. */
  jti: string;
}

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters");
  }
  return secret;
}

export function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean | null;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: Boolean(row.isAdmin),
  };
}

export async function issueAccessToken(user: AuthUser): Promise<string> {
  const expiresAt = new Date(Date.now() + config.sessionCookieMaxAgeMs);
  const session = await createAuthSession({ userId: user.id, expiresAt });
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    jti: session.id,
  };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

/** @deprecated Prefer issueAccessToken — kept name for callers that already await. */
export async function signAccessToken(user: AuthUser): Promise<string> {
  return issueAccessToken(user);
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, getJwtSecret()) as AuthTokenPayload & {
    jti?: string;
  };
  if (!payload.jti || typeof payload.jti !== "string") {
    throw new AuthError(
      "SESSION_REVOKED",
      "Session expired — sign in again",
    );
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    jti: payload.jti,
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ user: AuthUser; token: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const [created] = await getDb()
    .insert(users)
    .values({
      email,
      passwordHash,
      name: input.name.trim(),
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
    });

  if (!created) {
    throw new Error("Failed to create user");
  }

  const user = toPublicUser(created);
  await ensureDefaultConnectors(user.id);
  return { user, token: await issueAccessToken(user) };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  const email = input.email.trim().toLowerCase();
  const [row] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!row) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (row.disabledAt) {
    throw new AuthError("ACCOUNT_DISABLED", "This account has been disabled");
  }

  const valid = await bcrypt.compare(input.password, row.passwordHash);
  if (!valid) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  const user = toPublicUser(row);
  await ensureDefaultConnectors(user.id);
  return { user, token: await issueAccessToken(user) };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const [row] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return null;
  if (row.disabledAt) return null;
  return toPublicUser(row);
}

export async function changePasswordForUser(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  if (input.newPassword.length < 8) {
    throw new AuthError("WEAK_PASSWORD", "Password must be at least 8 characters");
  }
  const [row] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!row) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  const valid = await bcrypt.compare(input.currentPassword, row.passwordHash);
  if (!valid) {
    throw new AuthError("INVALID_CREDENTIALS", "Current password is incorrect");
  }
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await getDb()
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, input.userId));
  // Force re-login on other devices.
  await revokeAllAuthSessionsForUser(input.userId);
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    isAdmin: Boolean(r.isAdmin),
    disabledAt: r.disabledAt ? r.disabledAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function adminSetUserPassword(input: {
  targetUserId: string;
  newPassword: string;
}): Promise<void> {
  if (input.newPassword.length < 8) {
    throw new AuthError("WEAK_PASSWORD", "Password must be at least 8 characters");
  }
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  const updated = await getDb()
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, input.targetUserId))
    .returning({ id: users.id });
  if (!updated[0]) {
    throw new AuthError("NOT_FOUND", "User not found");
  }
  await revokeAllAuthSessionsForUser(input.targetUserId);
}

export async function adminSetUserDisabled(input: {
  actorUserId: string;
  targetUserId: string;
  disabled: boolean;
}): Promise<AdminUserRow> {
  if (input.actorUserId === input.targetUserId && input.disabled) {
    throw new AuthError("FORBIDDEN", "You cannot disable your own account");
  }
  const [row] = await getDb()
    .update(users)
    .set({ disabledAt: input.disabled ? new Date() : null })
    .where(eq(users.id, input.targetUserId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    });
  if (!row) {
    throw new AuthError("NOT_FOUND", "User not found");
  }
  if (input.disabled) {
    await revokeAllAuthSessionsForUser(input.targetUserId);
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: Boolean(row.isAdmin),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function adminSetUserAdmin(input: {
  actorUserId: string;
  targetUserId: string;
  isAdmin: boolean;
}): Promise<AdminUserRow> {
  if (input.actorUserId === input.targetUserId && !input.isAdmin) {
    const [{ count }] = await getDb()
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(users)
      .where(and(eq(users.isAdmin, true), isNull(users.disabledAt)));
    if (Number(count) <= 1) {
      throw new AuthError(
        "FORBIDDEN",
        "Cannot remove admin from the last active admin account",
      );
    }
  }
  const [row] = await getDb()
    .update(users)
    .set({ isAdmin: input.isAdmin })
    .where(eq(users.id, input.targetUserId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    });
  if (!row) {
    throw new AuthError("NOT_FOUND", "User not found");
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: Boolean(row.isAdmin),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function assertAuthConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new AuthError(
      "DATABASE_NOT_CONFIGURED",
      "Authentication requires DATABASE_URL",
    );
  }
  getJwtSecret();
}
