import { and, desc, eq, inArray } from "drizzle-orm";
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
const FULL_RECONCILE_FAILURE_BACKOFF_MS = 60 * 60_000;
const FULL_RECONCILE_FAILURE_BACKOFF_MAX_MS = 24 * 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function envMinutes(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value)
    ? Math.min(10_080, Math.max(1, value))
    : fallback;
}

export type EvernoteScheduleDecision = "full" | "incremental" | null;

type EvernoteReconcileOutcome = {
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
};

function reconcileFailureKey(message: string | null): string | null {
  const normalized = message?.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return null;
  const errorCodes = [
    ...normalized.matchAll(
      /\b(http(?: status)?|status|code)\s*[:=]?\s*([a-z][a-z0-9_-]*|\d{3})\b/g,
    ),
  ].map((match) => `${match[1]}:${match[2]}`);
  const signature = normalized
    .replace(
      /\b\d{4}-\d{2}-\d{2}(?:t\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:\d{2}))?\b/g,
      "<timestamp>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g,
      "<id>",
    )
    .replace(
      /\b(request|trace|run|job|sync)[ _-]?id\s*[:=]?\s*["'`]?[a-z0-9][a-z0-9._:-]*["'`]?/g,
      "$1 id <id>",
    )
    .replace(/\b(?:request|trace|run|job|sync)-[a-z0-9_-]{6,}\b/g, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<id>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return `${[...new Set(errorCodes)].sort().join(",")}|${signature}`;
}

export function repeatedFullReconcileFailureBackoffUntil(
  outcomes: EvernoteReconcileOutcome[],
  baseBackoffMs = FULL_RECONCILE_FAILURE_BACKOFF_MS,
): Date | null {
  const fullOutcomes = outcomes
    .filter((outcome) => outcome.metadata?.evernoteSyncMode !== "incremental")
    .sort(
      (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
    );
  const latest = fullOutcomes[0];
  if (!latest || latest.status !== "failed") return null;
  const failureKey = reconcileFailureKey(latest.errorMessage);
  if (!failureKey) return null;

  let identicalFailures = 0;
  for (const outcome of fullOutcomes) {
    if (
      outcome.status !== "failed" ||
      reconcileFailureKey(outcome.errorMessage) !== failureKey
    ) {
      break;
    }
    identicalFailures += 1;
  }
  if (identicalFailures < 2) return null;

  const delay = Math.min(
    baseBackoffMs * 2 ** Math.min(identicalFailures - 2, 8),
    FULL_RECONCILE_FAILURE_BACKOFF_MAX_MS,
  );
  const failedAt = latest.completedAt ?? latest.startedAt;
  return new Date(failedAt.getTime() + delay);
}

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
  fullReconcileBackoffUntil?: Date | null;
  incrementalMinutes: number;
  fullReconcileMinutes: number;
}): EvernoteScheduleDecision {
  const { now } = input;
  const fullReconcileBackedOff =
    input.fullReconcileBackoffUntil != null &&
    input.fullReconcileBackoffUntil.getTime() > now.getTime();
  const hasCompletedSync = Boolean(
    input.lastSyncAt ||
    input.lastFullReconcileAt ||
    input.attachmentBackfillInProgress ||
    input.fullReconcileBackoffUntil,
  );
  if (!hasCompletedSync) {
    return input.autoFullImportEnabled &&
      input.fullReconcileEnabled &&
      input.inNightWindow &&
      !fullReconcileBackedOff
      ? "full"
      : null;
  }
  if (
    !input.attachmentBackfillInProgress &&
    input.fullReconcileEnabled &&
    input.inNightWindow &&
    !fullReconcileBackedOff &&
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
    const fullReconcileEnabled = isEvernoteFullReconcileEnabled();
    let fullReconcileBackoffUntil: Date | null = null;
    if (inNightWindow && fullReconcileEnabled) {
      const recentOutcomes = await getDb()
        .select({
          status: syncRuns.status,
          startedAt: syncRuns.startedAt,
          completedAt: syncRuns.completedAt,
          errorMessage: syncRuns.errorMessage,
          metadata: syncRuns.metadata,
        })
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.connectorId, connector.id),
            inArray(syncRuns.status, ["complete", "partial_success", "failed"]),
          ),
        )
        .orderBy(desc(syncRuns.startedAt))
        .limit(10);
      fullReconcileBackoffUntil =
        repeatedFullReconcileFailureBackoffUntil(recentOutcomes);
    }
    const mode = evernoteScheduleDecision({
      now,
      lastSyncAt: connector.lastSyncAt,
      lastFullReconcileAt: state?.lastFullReconcileAt ?? null,
      incrementalEnabled: isEvernoteIncrementalSyncEnabled(),
      fullReconcileEnabled,
      autoFullImportEnabled: isEvernoteAutoFullImportEnabled(),
      inNightWindow,
      attachmentBackfillInProgress: attachmentBackfills.has(connector.id),
      fullReconcileBackoffUntil,
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
