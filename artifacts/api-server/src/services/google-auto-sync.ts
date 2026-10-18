import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { connectors } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { isEnabled } from "../lib/feature-flags";
import { logger } from "../lib/logger";
import { enqueueGoogleSyncForUser } from "./connectors";
import { nudgeJobWorker } from "./job-worker";

const GOOGLE_STALE_MS = 6 * 60 * 60 * 1000;
const GOOGLE_TICK_MS = 30 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function isGoogleAutoSyncEnabled(): boolean {
  return isEnabled("RECALL_GOOGLE_AUTO_SYNC_ENABLED", false);
}

/** Select and durably enqueue at most one stale Google connector. */
export async function syncStaleGoogleConnectors(): Promise<number> {
  if (!isGoogleAutoSyncEnabled() || running) return 0;
  running = true;
  try {
    const cutoff = new Date(Date.now() - GOOGLE_STALE_MS);
    const rows = await getDb()
      .select({
        id: connectors.id,
        userId: connectors.userId,
      })
      .from(connectors)
      .where(
        and(
          eq(connectors.type, "google"),
          eq(connectors.enabled, true),
          or(isNull(connectors.lastSyncAt), lt(connectors.lastSyncAt, cutoff)),
        ),
      )
      .orderBy(
        sql`${connectors.lastSyncAt} asc nulls first`,
        connectors.createdAt,
      )
      .limit(1);
    const connector = rows[0];
    if (!connector) return 0;

    const queued = await enqueueGoogleSyncForUser(
      connector.userId,
      connector.id,
      { scheduled: true },
    );
    if (queued.deduped) return 0;
    nudgeJobWorker(queued.jobId);
    logger.info(
      {
        connectorId: connector.id,
        userId: connector.userId,
        jobId: queued.jobId,
      },
      "Queued stale Google connector sync",
    );
    return 1;
  } catch (error) {
    logger.warn({ error }, "Google auto-sync scheduler tick failed");
    return 0;
  } finally {
    running = false;
  }
}

export async function enqueueGoogleInitialSyncIfEnabled(
  userId: string,
  connectorId: string,
): Promise<boolean> {
  if (!isGoogleAutoSyncEnabled()) return false;
  const queued = await enqueueGoogleSyncForUser(userId, connectorId, {
    scheduled: true,
  });
  if (!queued.deduped) nudgeJobWorker(queued.jobId);
  return true;
}

export function startGoogleAutoSync(): void {
  if (!isGoogleAutoSyncEnabled() || timer || initialTimer) return;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void syncStaleGoogleConnectors();
  }, 20_000);
  initialTimer.unref?.();
  timer = setInterval(() => {
    void syncStaleGoogleConnectors();
  }, GOOGLE_TICK_MS);
  timer.unref?.();
  logger.info("Google auto-sync scheduler started");
}

/** Test helper. */
export function stopGoogleAutoSync(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
  running = false;
}
