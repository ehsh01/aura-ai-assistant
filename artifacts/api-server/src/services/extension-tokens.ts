import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { extensionTokens } from "@workspace/db/schema";
import { getDb } from "../lib/db";

const TOKEN_PREFIX = "recall_ext_";
const DEFAULT_TTL_DAYS = 90;
const MAX_TTL_DAYS = 365;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export type ExtensionTokenDto = {
  id: string;
  name: string;
  scope: "capture:create";
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function hashExtensionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateExtensionTokenValue(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function toDto(row: typeof extensionTokens.$inferSelect): ExtensionTokenDto {
  return {
    id: row.id,
    name: row.name,
    scope: "capture:create",
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function isExtensionToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

export function isExtensionTokenRecordUsable(
  row: Pick<typeof extensionTokens.$inferSelect, "scope" | "expiresAt" | "revokedAt">,
  now = new Date(),
): boolean {
  return (
    row.scope === "capture:create" &&
    row.revokedAt === null &&
    row.expiresAt.getTime() > now.getTime()
  );
}

export async function createExtensionTokenForUser(
  userId: string,
  input?: { name?: string; expiresInDays?: number },
): Promise<{ token: string; item: ExtensionTokenDto }> {
  const days = Math.min(
    Math.max(Math.trunc(input?.expiresInDays ?? DEFAULT_TTL_DAYS), 1),
    MAX_TTL_DAYS,
  );
  const token = generateExtensionTokenValue();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const id = `ext-${randomUUID()}`;

  const [created] = await getDb()
    .insert(extensionTokens)
    .values({
      id,
      userId,
      name: input?.name?.trim().slice(0, 120) || "Recall browser extension",
      tokenHash: hashExtensionToken(token),
      scope: "capture:create",
      expiresAt,
      createdAt: now,
    })
    .returning();

  if (!created) throw new Error("Failed to create extension token");
  return { token, item: toDto(created) };
}

export async function listExtensionTokensForUser(
  userId: string,
): Promise<ExtensionTokenDto[]> {
  const rows = await getDb()
    .select()
    .from(extensionTokens)
    .where(eq(extensionTokens.userId, userId))
    .orderBy(desc(extensionTokens.createdAt))
    .limit(20);
  return rows.map(toDto);
}

export async function revokeExtensionTokenForUser(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(extensionTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(extensionTokens.id, tokenId), eq(extensionTokens.userId, userId)))
    .returning({ id: extensionTokens.id });
  return rows.length > 0;
}

/**
 * Validate a capture-only token and return its owner.
 * Full web-session JWTs are deliberately handled by the normal auth middleware.
 */
export async function authenticateExtensionToken(
  token: string,
): Promise<{ userId: string; tokenId: string } | null> {
  if (!isExtensionToken(token)) return null;

  const [row] = await getDb()
    .select()
    .from(extensionTokens)
    .where(eq(extensionTokens.tokenHash, hashExtensionToken(token)))
    .limit(1);

  const now = new Date();
  if (!row || !isExtensionTokenRecordUsable(row, now)) return null;

  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
  ) {
    void getDb()
      .update(extensionTokens)
      .set({ lastUsedAt: now })
      .where(eq(extensionTokens.id, row.id))
      .catch(() => undefined);
  }

  return { userId: row.userId, tokenId: row.id };
}
