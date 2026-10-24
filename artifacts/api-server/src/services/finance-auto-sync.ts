import { and, eq, isNull, lt, or } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { enqueueFinanceSyncForUser } from "./connectors";
import { logger } from "../lib/logger";
import { nudgeJobWorker } from "./job-worker";
import { checkEvernoteImportWatchdog } from "./evernote-watchdog";

/** Background scheduler: only re-sync if older than this. */
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
/** App-open/Home refresh cooldown; Ask explicitly uses five minutes. */
export const FINANCE_ON_DEMAND_COOLDOWN_MS = 20 * 60 * 1000;
const TICK_MS = 30 * 60 * 1000; // every 30 minutes
const MAX_PER_TICK = 1;

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
      .orderBy(connectors.updatedAt)
      .limit(20);

    let synced = 0;
    for (const row of rows) {
      try {
        const watchdog = await checkEvernoteImportWatchdog();
        if (!watchdog.safe) {
          logger.info(
            { connectorId: row.id, reasons: watchdog.reasons },
            "Finance auto-sync deferred by load watchdog",
          );
          return 0;
        }
        const queued = await enqueueFinanceSyncForUser(
          row.userId,
          row.id,
          { scheduled: true },
        );
        if (queued.deduped) continue;
        nudgeJobWorker(queued.jobId);
        synced += 1;
        logger.info(
          { connectorId: row.id, userId: row.userId, jobId: queued.jobId },
          "Queued finance auto-sync",
        );
        if (synced >= MAX_PER_TICK) break;
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
  /** Skip sync if last sync was within this many ms. Default: 20 minutes. */
  maxAgeMs?: number;
};

/**
 * Refresh the user's finance connector from MyFamilyBudget.
 * Used on app open and before finance Ask answers. It only queues durable
 * worker work; callers always continue from the last completed snapshot.
 */
export async function ensureUserFinanceFresh(
  userId: string,
  opts?: EnsureFinanceFreshOptions,
): Promise<{
  synced: boolean;
  skipped: boolean;
  updating: boolean;
}> {
  const maxAgeMs = opts?.maxAgeMs ?? FINANCE_ON_DEMAND_COOLDOWN_MS;

  const rows = await getDb()
    .select({
      id: connectors.id,
      lastSyncAt: connectors.lastSyncAt,
      syncStatus: connectors.syncStatus,
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
  if (!conn) return { synced: false, skipped: true, updating: false };

  if (
    maxAgeMs > 0 &&
    conn.lastSyncAt &&
    Date.now() - conn.lastSyncAt.getTime() < maxAgeMs
  ) {
    return {
      synced: false,
      skipped: true,
      updating: conn.syncStatus === "syncing",
    };
  }

  try {
    const queued = await enqueueFinanceSyncForUser(userId, conn.id);
    if (!queued.deduped) nudgeJobWorker(queued.jobId);
    return {
      synced: false,
      skipped: queued.deduped,
      updating: true,
    };
  } catch (err) {
    logger.warn({ err, userId, connectorId: conn.id }, "Could not queue finance sync");
    return { synced: false, skipped: false, updating: false };
  }
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
