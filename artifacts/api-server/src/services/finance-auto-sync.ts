import { and, eq, isNull, lt, or } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { syncConnectorForUser } from "./connectors";
import { logger } from "../lib/logger";

/** Background scheduler: only re-sync if older than this. */
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
/** App-open / Ask: skip only if synced within this window (avoid double-hit). */
const OPEN_COOLDOWN_MS = 45 * 1000;
/**
 * Longest a request may block on a finance sync before answering from the last
 * snapshot. Without a bound, every caller waits for the full MyFamilyBudget
 * pull; requests then stack up for minutes and the process runs out of heap.
 */
export const ON_DEMAND_SYNC_TIMEOUT_MS = 8_000;
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
  /**
   * When awaitSync is true, give up waiting after this many ms and let the
   * caller answer from the last synced snapshot (sync continues in background).
   */
  timeoutMs?: number;
};

/**
 * One in-flight sync per user. Concurrent refresh calls (app open + Ask +
 * summary, or a user re-triggering after an aborted request) share the same
 * promise instead of stacking full syncs — each sync holds DB connections on
 * a shared cluster, so fan-out here starved sibling apps.
 */
const inflightSyncs = new Map<string, Promise<unknown>>();

function runCoalescedSync(userId: string, connectorId: string): Promise<unknown> {
  const existing = inflightSyncs.get(userId);
  if (existing) return existing;
  const run = syncConnectorForUser(userId, connectorId).finally(() => {
    inflightSyncs.delete(userId);
  });
  inflightSyncs.set(userId, run);
  return run;
}

function delay(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}

/**
 * Refresh the user's finance connector from MyFamilyBudget.
 * Used on app open and before finance Ask answers.
 */
export async function ensureUserFinanceFresh(
  userId: string,
  opts?: EnsureFinanceFreshOptions,
): Promise<{ synced: boolean; skipped: boolean; timedOut?: boolean }> {
  const maxAgeMs = opts?.maxAgeMs ?? OPEN_COOLDOWN_MS;
  const awaitSync = opts?.awaitSync !== false;
  const timeoutMs = opts?.timeoutMs;

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

  const run = runCoalescedSync(userId, conn.id);
  if (awaitSync) {
    try {
      if (timeoutMs != null && timeoutMs > 0) {
        const winner = await Promise.race([
          run.then(() => "done" as const),
          delay(timeoutMs),
        ]);
        if (winner === "timeout") {
          logger.warn(
            { userId, connectorId: conn.id, timeoutMs },
            "On-demand finance sync still running; answering from last snapshot",
          );
          return { synced: false, skipped: false, timedOut: true };
        }
      } else {
        await run;
      }
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
