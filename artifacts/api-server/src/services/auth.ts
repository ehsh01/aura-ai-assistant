import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { users } from "@workspace/db/schema";
import { getDb, isDatabaseConfigured } from "../lib/db";

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = process.env.JWT_EXPIRES_IN ?? "7d";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthTokenPayload {
  sub: string;
  email: string;
  name: string;
}

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
}): AuthUser {
  return { id: row.id, email: row.email, name: row.name };
}

export function signAccessToken(user: AuthUser): string {
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
  };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
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
    .returning({ id: users.id, email: users.email, name: users.name });

  if (!created) {
    throw new Error("Failed to create user");
  }

  const user = toPublicUser(created);
  return { user, token: signAccessToken(user) };
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

  const valid = await bcrypt.compare(input.password, row.passwordHash);
  if (!valid) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  const user = toPublicUser(row);
  return { user, token: signAccessToken(user) };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ? toPublicUser(row) : null;
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
