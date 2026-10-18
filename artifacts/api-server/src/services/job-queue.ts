import { and, eq, lt, sql } from "drizzle-orm";
import { jobs, type Job } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newExtractionJobId } from "../lib/recall-format";

export type { Job };

export const JOB_TYPE_CAPTURE_EXTRACTION = "capture_extraction" as const;
export const JOB_TYPE_ATTACHMENT_EXTRACT = "attachment_extract" as const;
export const JOB_TYPE_ENEX_IMPORT = "enex_import" as const;
export const JOB_TYPE_DIGEST_REGEN = "digest_regen" as const;
export const JOB_TYPE_ATTENTION_SCAN = "attention_scan" as const;
export const JOB_TYPE_WAITING_SCAN = "waiting_scan" as const;
export const JOB_TYPE_CONNECTOR_SYNC = "connector_sync" as const;

export type JobStatus = "queued" | "processing" | "complete" | "failed";

export type CaptureExtractionPayload = {
  captureId: string;
};

export type EnqueueJobInput = {
  userId: string;
  type: typeof JOB_TYPE_CAPTURE_EXTRACTION | string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  /** Optional stable id (e.g. keep extraction jobId shape for clients). */
  id?: string;
};

const DEFAULT_MAX_ATTEMPTS = 3;
/** Re-queue jobs stuck in processing longer than this (API crash mid-run). */
export const STALE_PROCESSING_MS = 15 * 60 * 1000;
/** Bound crash/deploy recovery independently from real execution failures. */
export const MAX_STALE_RECOVERIES = 20;

export function backoffMs(attemptsAfterFail: number): number {
  // 30s, 2m, 8m — capped
  const base = 30_000 * 4 ** Math.max(0, attemptsAfterFail - 1);
  return Math.min(base, 30 * 60_000);
}

export function attemptsAfterDeferredClaim(claimedAttempts: number): number {
  return Math.max(0, Math.floor(claimedAttempts) - 1);
}

export function isNonRetryableCodeError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "nonRetryable" in error &&
      error.nonRetryable === true,
  );
}

export function evernoteTransientDeferral(error: unknown): {
  retryAfterMs: number;
} | null {
  if (!error || typeof error !== "object") return null;
  const details = error as Record<string, unknown>;
  const data =
    details.data && typeof details.data === "object"
      ? (details.data as Record<string, unknown>)
      : {};
  const status = Number(
    details.status ?? details.statusCode ?? data.status ?? data.statusCode,
  );
  const message = error instanceof Error ? error.message : "";
  if (
    details.evernoteRateLimited !== true &&
    details.evernoteTransient !== true &&
    status !== 429 &&
    ![502, 503, 504].includes(status) &&
    !/\b429\b|rate.?limit|\b50[234]\b|backend read error|<!doctype html|<html/i.test(
      message,
    )
  ) {
    return null;
  }
  const retryAfterMs =
    typeof details.retryAfterMs === "number"
      ? details.retryAfterMs
      : 30_000;
  return {
    retryAfterMs: Math.min(Math.max(retryAfterMs, 1_000), 3_600_000),
  };
}

export function jobFailureIsTerminal(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts >= maxAttempts;
}

type RawJobRow = Record<string, unknown>;

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return null;
}

/** Map pg/drizzle raw rows (snake_case or camelCase) onto the Job shape. */
export function mapJobRow(row: RawJobRow): Job {
  const payload = row.payload;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? row.userId),
    type: String(row.type),
    payload:
      payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {},
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    lastError: (row.last_error ?? row.lastError ?? null) as string | null,
    availableAt: asDate(row.available_at ?? row.availableAt) ?? new Date(),
    lockedAt: asDate(row.locked_at ?? row.lockedAt),
    lockedBy: (row.locked_by ?? row.lockedBy ?? null) as string | null,
    startedAt: asDate(row.started_at ?? row.startedAt),
    completedAt: asDate(row.completed_at ?? row.completedAt),
    createdAt: asDate(row.created_at ?? row.createdAt) ?? new Date(),
    updatedAt: asDate(row.updated_at ?? row.updatedAt) ?? new Date(),
  };
}

export async function enqueueJob(input: EnqueueJobInput): Promise<Job> {
  const id = input.id ?? newExtractionJobId();
  const now = new Date();
  const rows = await getDb()
    .insert(jobs)
    .values({
      id,
      userId: input.userId,
      type: input.type,
      payload: input.payload,
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: jobs.id })
    .returning();
  const row = rows[0];
  if (row) return row;
  // Idempotent re-enqueue (e.g. stable ENEX resume id).
  const existing = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (existing[0]) return existing[0];
  throw new Error("Failed to enqueue job");
}

export async function getJobForUser(userId: string, jobId: string): Promise<Job | null> {
  const rows = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listQueuedJobsOfType(
  type: string,
  limit = 100,
): Promise<Job[]> {
  return getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, type), eq(jobs.status, "queued")))
    .orderBy(jobs.availableAt, jobs.createdAt)
    .limit(Math.min(Math.max(limit, 1), 1_000));
}

/**
 * Atomically claim the next due queued job (Postgres SKIP LOCKED).
 * Returns null when the queue is empty.
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  return claimNextJobOfTypes(workerId);
}

/** Polling workers may be restricted to job types that cannot invoke paid AI. */
export async function claimNextJobOfTypes(workerId: string, allowedTypes?: readonly string[]): Promise<Job | null> {
  const typeFilter =
    allowedTypes && allowedTypes.length > 0
      ? sql`AND type IN (${sql.join(
          allowedTypes.map((type) => sql`${type}`),
          sql`, `,
        )})`
      : sql``;
  const result = await getDb().execute(sql`
    UPDATE jobs
    SET
      status = 'processing',
      locked_at = now(),
      locked_by = ${workerId},
      started_at = COALESCE(started_at, now()),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id
      FROM jobs
      WHERE status = 'queued'
        AND available_at <= now()
        ${typeFilter}
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);

  const rawRows = (result as { rows?: RawJobRow[] }).rows ?? (Array.isArray(result) ? (result as RawJobRow[]) : []);
  const row = rawRows[0];
  return row ? mapJobRow(row) : null;
}

/** Claim one freshly enqueued job from its user/save action, never from a sweep. */
export async function claimJobById(workerId: string, jobId: string): Promise<Job | null> {
  const result = await getDb().execute(sql`
    UPDATE jobs
    SET
      status = 'processing',
      locked_at = now(),
      locked_by = ${workerId},
      started_at = COALESCE(started_at, now()),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = ${jobId}
      AND status = 'queued'
      AND available_at <= now()
    RETURNING *
  `);
  const rawRows = (result as { rows?: RawJobRow[] }).rows ?? (Array.isArray(result) ? (result as RawJobRow[]) : []);
  const row = rawRows[0];
  return row ? mapJobRow(row) : null;
}

export async function completeJob(jobId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(jobs)
    .set({
      status: "complete",
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
}

/** Keep a long-running paged job from being mistaken for an abandoned worker. */
export async function heartbeatJob(jobId: string): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ lockedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "processing")));
}

/** Yield a successfully checkpointed long job back to the shared worker queue. */
export async function continueJob(jobId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      availableAt: new Date(now.getTime() + 1_000),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "processing")));
}

/** Pause a claimed job without consuming a retry attempt (load watchdog). */
export async function deferJob(jobId: string, delayMs: number, reason: string): Promise<void> {
  const now = new Date();
  const boundedDelay = Math.min(Math.max(delayMs, 1_000), 3_600_000);
  await getDb()
    .update(jobs)
    .set({
      status: "queued",
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      availableAt: new Date(now.getTime() + boundedDelay),
      lockedAt: null,
      lockedBy: null,
      lastError: reason.slice(0, 1_000),
      updatedAt: now,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "processing")));
}

/**
 * Mark failure. If attempts remain, re-queue with backoff.
 * @returns whether the job is terminally failed
 */
export async function failJob(
  jobId: string,
  error: string,
  options?: { retryAfterMs?: number; forceTerminal?: boolean },
): Promise<boolean> {
  const rows = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = rows[0];
  if (!job) return true;

  const now = new Date();
  const terminal =
    options?.forceTerminal === true ||
    jobFailureIsTerminal(job.attempts, job.maxAttempts);

  if (terminal) {
    await getDb()
      .update(jobs)
      .set({
        status: "failed",
        lastError: error,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));
    return true;
  }

  const retryAfterMs =
    typeof options?.retryAfterMs === "number" &&
    Number.isFinite(options.retryAfterMs)
      ? Math.min(Math.max(options.retryAfterMs, 0), 60_000)
      : 0;
  const delay = Math.max(backoffMs(job.attempts), retryAfterMs);
  await getDb()
    .update(jobs)
    .set({
      status: "queued",
      lastError: error,
      availableAt: new Date(now.getTime() + delay),
      lockedAt: null,
      lockedBy: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
  return false;
}

/** Re-queue processing jobs abandoned after a crash / deploy. */
export async function recoverStaleProcessingJobs(olderThanMs: number = STALE_PROCESSING_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const staleRecoveries = sql<number>`case
    when jsonb_typeof(${jobs.payload}->'staleRecoveryCount') = 'number'
      then greatest((${jobs.payload}->>'staleRecoveryCount')::int, 0)
    else 0
  end`;
  const result = await getDb()
    .update(jobs)
    .set({
      status: sql`case
        when ${staleRecoveries} + 1 >= ${MAX_STALE_RECOVERIES} then 'failed'
        else 'queued'
      end`,
      // A claim spends one attempt. A dead worker never produced a real
      // failure, so refund that claim and track recovery separately.
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      payload: sql`${jobs.payload} || jsonb_build_object(
        'staleRecoveryCount',
        ${staleRecoveries} + 1
      )`,
      lockedAt: null,
      lockedBy: null,
      availableAt: new Date(),
      updatedAt: new Date(),
      completedAt: sql`case
        when ${staleRecoveries} + 1 >= ${MAX_STALE_RECOVERIES} then now()
        else null
      end`,
      lastError: sql`case
        when ${staleRecoveries} + 1 >= ${MAX_STALE_RECOVERIES}
          then 'Stale processing recovery limit reached'
        else 'Recovered after stale processing lock'
      end`,
    })
    .where(and(eq(jobs.status, "processing"), lt(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return result.length;
}

export function captureIdFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.captureId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function attachmentIdFromPayload(payload: Record<string, unknown>): string | null {
  const value = payload.attachmentId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function enexImportFromPayload(payload: Record<string, unknown>): { filePath: string; fileName: string } | null {
  const filePath = payload.filePath;
  const fileName = payload.fileName;
  if (typeof filePath !== "string" || !filePath) return null;
  if (typeof fileName !== "string" || !fileName) return null;
  return { filePath, fileName };
}

export function connectorSyncFromPayload(
  payload: Record<string, unknown>,
): { connectorId: string; syncRunId: string } | null {
  const connectorId = payload.connectorId;
  const syncRunId = payload.syncRunId;
  if (typeof connectorId !== "string" || !connectorId) return null;
  if (typeof syncRunId !== "string" || !syncRunId) return null;
  return { connectorId, syncRunId };
}

/** Lightweight queue counts for health / ops. */
export async function getJobQueueStats(): Promise<{
  queued: number;
  processing: number;
  failed: number;
}> {
  const rows = await getDb()
    .select({
      status: jobs.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(jobs)
    .where(sql`${jobs.status} in ('queued', 'processing', 'failed')`)
    .groupBy(jobs.status);

  const out = { queued: 0, processing: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === "queued") out.queued = Number(row.count) || 0;
    if (row.status === "processing") out.processing = Number(row.count) || 0;
    if (row.status === "failed") out.failed = Number(row.count) || 0;
  }
  return out;
}
