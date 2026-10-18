import { and, eq, inArray } from "drizzle-orm";
import {
  connectors,
  evernoteSyncState,
  jobs,
  syncRuns,
} from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import {
  enqueueEvernoteSyncForUser,
  isEvernoteAttachmentBackfill,
} from "./connectors";
import {
  isEvernoteAutoFullImportEnabled,
  isEvernoteFullReconcileEnabled,
  isEvernoteIncrementalSyncEnabled,
  isEvernoteNightWindow,
  isEvernoteSchedulerEnabled,
} from "./evernote-runtime-policy";
import { checkEvernoteImportWatchdog } from "./evernote-watchdog";

const SCHEDULER_TICK_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function envMinutes(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value)
    ? Math.min(10_080, Math.max(1, value))
    : fallback;
}

export type EvernoteScheduleDecision = "full" | "incremental" | null;

export async function scheduledEvernoteLoadIsSafe(
  check: typeof checkEvernoteImportWatchdog = checkEvernoteImportWatchdog,
): Promise<boolean> {
  return (await check()).safe;
}

export function evernoteScheduleDecision(input: {
  now: Date;
  lastSyncAt: Date | null;
  lastFullReconcileAt: Date | null;
  incrementalEnabled: boolean;
  fullReconcileEnabled: boolean;
  autoFullImportEnabled: boolean;
  inNightWindow: boolean;
  attachmentBackfillInProgress?: boolean;
  incrementalMinutes: number;
  fullReconcileMinutes: number;
}): EvernoteScheduleDecision {
  const { now } = input;
  const hasCompletedSync = Boolean(
    input.lastSyncAt ||
    input.lastFullReconcileAt ||
    input.attachmentBackfillInProgress,
  );
  if (!hasCompletedSync) {
    return input.autoFullImportEnabled &&
      input.fullReconcileEnabled &&
      input.inNightWindow
      ? "full"
      : null;
  }
  if (
    !input.attachmentBackfillInProgress &&
    input.fullReconcileEnabled &&
    input.inNightWindow &&
    (!input.lastFullReconcileAt ||
      now.getTime() - input.lastFullReconcileAt.getTime() >=
        input.fullReconcileMinutes * 60_000)
  ) {
    return "full";
  }
  if (
    input.incrementalEnabled &&
    (!input.lastSyncAt ||
      now.getTime() - input.lastSyncAt.getTime() >=
        input.incrementalMinutes * 60_000)
  ) {
    return "incremental";
  }
  return null;
}

export async function scheduleDueEvernoteSyncs(
  now = new Date(),
): Promise<number> {
  if (!isEvernoteSchedulerEnabled()) return 0;
  const rows = await getDb()
    .select({
      connector: connectors,
      state: evernoteSyncState,
    })
    .from(connectors)
    .leftJoin(
      evernoteSyncState,
      eq(evernoteSyncState.connectorId, connectors.id),
    )
    .where(and(eq(connectors.type, "evernote"), eq(connectors.enabled, true)));
  const activeRuns = await getDb()
    .select({
      connectorId: syncRuns.connectorId,
      metadata: syncRuns.metadata,
    })
    .from(syncRuns)
    .innerJoin(jobs, eq(jobs.id, syncRuns.id))
    .where(
      and(
        inArray(syncRuns.status, ["queued", "running"]),
        inArray(jobs.status, ["queued", "processing"]),
      ),
    );
  const attachmentBackfills = new Set(
    activeRuns
      .filter((run) => isEvernoteAttachmentBackfill(run.metadata))
      .map((run) => run.connectorId),
  );
  let queued = 0;
  for (const { connector, state } of rows) {
    const inNightWindow = isEvernoteNightWindow(now);
    const mode = evernoteScheduleDecision({
      now,
      lastSyncAt: connector.lastSyncAt,
      lastFullReconcileAt: state?.lastFullReconcileAt ?? null,
      incrementalEnabled: isEvernoteIncrementalSyncEnabled(),
      fullReconcileEnabled: isEvernoteFullReconcileEnabled(),
      autoFullImportEnabled: isEvernoteAutoFullImportEnabled(),
      inNightWindow,
      attachmentBackfillInProgress: attachmentBackfills.has(connector.id),
      incrementalMinutes: envMinutes("EVERNOTE_INCREMENTAL_SYNC_MINUTES", 15),
      fullReconcileMinutes: envMinutes(
        "EVERNOTE_FULL_RECONCILE_MINUTES",
        24 * 60,
      ),
    });
    if (!mode) continue;
    const loadSafe = await scheduledEvernoteLoadIsSafe();
    if (!loadSafe) {
      logger.info(
        { connectorId: connector.id, mode },
        "Evernote scheduled sync deferred by load watchdog",
      );
      continue;
    }
    try {
      const result = await enqueueEvernoteSyncForUser(
        connector.userId,
        connector.id,
        mode,
        { scheduled: true },
      );
      if (result.status === "queued") {
        queued += 1;
        const { nudgeJobWorker } = await import("./job-worker");
        nudgeJobWorker(result.jobId);
      }
    } catch (error) {
      logger.warn(
        { error, connectorId: connector.id, mode },
        "Could not schedule Evernote sync",
      );
    }
  }
  return queued;
}

export function startEvernoteSyncScheduler(): void {
  if (timer || !isEvernoteSchedulerEnabled()) return;
  const initial = setTimeout(() => {
    void scheduleDueEvernoteSyncs();
  }, 30_000);
  initial.unref?.();
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void scheduleDueEvernoteSyncs()
      .catch((error) => logger.warn({ error }, "Evernote scheduler failed"))
      .finally(() => {
        running = false;
      });
  }, SCHEDULER_TICK_MS);
  timer.unref?.();
}

export function stopEvernoteSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
