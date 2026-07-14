import { and, eq, isNull } from "drizzle-orm";
import { authSessions } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAuthSessionId } from "../lib/recall-format";

export type AuthSessionRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export async function createAuthSession(input: {
  userId: string;
  expiresAt: Date;
}): Promise<AuthSessionRow> {
  const id = newAuthSessionId();
  const now = new Date();
  const [row] = await getDb()
    .insert(authSessions)
    .values({
      id,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning();
  return {
    id: row!.id,
    userId: row!.userId,
    expiresAt: row!.expiresAt,
    revokedAt: row!.revokedAt ?? null,
  };
}

/** Returns true when the session exists, belongs to an active unexpired row. */
export async function assertAuthSessionActive(sessionId: string): Promise<boolean> {
  const [row] = await getDb()
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    .limit(1);
  if (!row) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;

  // Best-effort last-seen bump (ignore races / failures).
  void (async () => {
    try {
      await getDb()
        .update(authSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(authSessions.id, sessionId));
    } catch {
      /* ignore */
    }
  })();

  return true;
}

export async function revokeAuthSession(
  sessionId: string,
  userId?: string,
): Promise<boolean> {
  const conditions = [eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)];
  if (userId) conditions.push(eq(authSessions.userId, userId));
  const [row] = await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: authSessions.id });
  return Boolean(row);
}

export async function revokeAllAuthSessionsForUser(userId: string): Promise<number> {
  const rows = await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return rows.length;
}
