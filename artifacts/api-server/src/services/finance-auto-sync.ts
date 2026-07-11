import { and, eq, isNull, lt, or } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { syncConnectorForUser } from "./connectors";
import { logger } from "../lib/logger";

/** Background scheduler: only re-sync if older than this. */
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
/** App-open / Ask: skip only if synced within this window (avoid double-hit). */
const OPEN_COOLDOWN_MS = 45 * 1000;
const TICK_MS = 30 * 60 * 1000; // every 30 minutes
const MAX_PER_TICK = 3;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Sync finance connectors that are stale or never synced.
 * Runs a small batch per tick so we don't hammer MyFamilyBudget.
 */
export async function syncStaleFinanceConnectors(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const rows = await getDb()
      .select({
        id: connectors.id,
        userId: connectors.userId,
        lastSyncAt: connectors.lastSyncAt,
      })
      .from(connectors)
      .where(
        and(
          eq(connectors.type, "finance_api"),
          eq(connectors.enabled, true),
          or(isNull(connectors.lastSyncAt), lt(connectors.lastSyncAt, cutoff)),
        ),
      )
      .limit(MAX_PER_TICK);

    let synced = 0;
    for (const row of rows) {
      try {
        await syncConnectorForUser(row.userId, row.id);
        synced += 1;
        logger.info(
          { connectorId: row.id, userId: row.userId },
          "Auto-synced finance connector",
        );
      } catch (err) {
        logger.warn(
          { err, connectorId: row.id, userId: row.userId },
          "Finance auto-sync failed",
        );
      }
    }
    return synced;
  } finally {
    running = false;
  }
}

export type EnsureFinanceFreshOptions = {
  /** Skip sync if last sync was within this many ms. Default: 45s cooldown. */
  maxAgeMs?: number;
  /** Wait for sync to finish before returning (Home / Ask). Default true. */
  awaitSync?: boolean;
};

/**
 * Refresh the user's finance connector from MyFamilyBudget.
 * Used on app open and before finance Ask answers.
 */
export async function ensureUserFinanceFresh(
  userId: string,
  opts?: EnsureFinanceFreshOptions,
): Promise<{ synced: boolean; skipped: boolean }> {
  const maxAgeMs = opts?.maxAgeMs ?? OPEN_COOLDOWN_MS;
  const awaitSync = opts?.awaitSync !== false;

  const rows = await getDb()
    .select({
      id: connectors.id,
      lastSyncAt: connectors.lastSyncAt,
    })
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, userId),
        eq(connectors.type, "finance_api"),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);

  const conn = rows[0];
  if (!conn) return { synced: false, skipped: true };

  if (
    maxAgeMs > 0 &&
    conn.lastSyncAt &&
    Date.now() - conn.lastSyncAt.getTime() < maxAgeMs
  ) {
    return { synced: false, skipped: true };
  }

  const run = syncConnectorForUser(userId, conn.id);
  if (awaitSync) {
    try {
      await run;
      return { synced: true, skipped: false };
    } catch (err) {
      logger.warn({ err, userId, connectorId: conn.id }, "On-demand finance sync failed");
      return { synced: false, skipped: false };
    }
  }

  void run.catch((err) => {
    logger.warn({ err, userId, connectorId: conn.id }, "On-demand finance sync failed");
  });
  return { synced: true, skipped: false };
}

export function startFinanceAutoSync(): void {
  if (timer) return;
  // Initial delay so boot isn't competing with migrations/health checks.
  setTimeout(() => {
    void syncStaleFinanceConnectors();
  }, 20_000);
  timer = setInterval(() => {
    void syncStaleFinanceConnectors();
  }, TICK_MS);
  timer.unref?.();
  logger.info("Finance auto-sync scheduler started");
}
