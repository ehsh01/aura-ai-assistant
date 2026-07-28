import { hostname } from "node:os";
import { logger } from "../lib/logger";
import { updateCaptureStatusForUser } from "./captures";
import {
  JOB_TYPE_ATTACHMENT_EXTRACT,
  JOB_TYPE_ATTENTION_SCAN,
  JOB_TYPE_CAPTURE_EXTRACTION,
  JOB_TYPE_DIGEST_REGEN,
  JOB_TYPE_ENEX_IMPORT,
  JOB_TYPE_WAITING_SCAN,
  attachmentIdFromPayload,
  captureIdFromPayload,
  claimNextJob,
  completeJob,
  enexImportFromPayload,
  failJob,
  recoverStaleProcessingJobs,
  type Job,
} from "./job-queue";

const POLL_MS = 2_000;
const STALE_RECOVERY_EVERY_TICKS = 30;

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;
let wakeRequested = false;
let ticks = 0;

const workerId = `recall-api:${hostname()}:${process.pid}`;

type JobHandler = (job: Job) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  [JOB_TYPE_CAPTURE_EXTRACTION]: async (job) => {
    const captureId = captureIdFromPayload(job.payload);
    if (!captureId) {
      throw new Error("capture_extraction job missing captureId");
    }
    const { processCaptureExtraction } = await import("./capture-pipeline");
    await processCaptureExtraction(job.userId, captureId);
  },
  [JOB_TYPE_ATTACHMENT_EXTRACT]: async (job) => {
    const attachmentId = attachmentIdFromPayload(job.payload);
    if (!attachmentId) {
      throw new Error("attachment_extract job missing attachmentId");
    }
    const { extractAndStoreAttachmentText } = await import("./attachment-text-extract");
    // Do not persist empty text on failure — that marks the attachment as
    // "extracted" and Ask treats it as having no OCR forever (no retry).
    await extractAndStoreAttachmentText(attachmentId);
  },
  [JOB_TYPE_ENEX_IMPORT]: async (job) => {
    const meta = enexImportFromPayload(job.payload);
    if (!meta) {
      throw new Error("enex_import job missing filePath/fileName");
    }
    const statusJobId =
      typeof job.payload.statusJobId === "string" && job.payload.statusJobId
        ? job.payload.statusJobId
        : job.id;
    const { processEnexImportJob } = await import("./enex-import-jobs");
    await processEnexImportJob(job.userId, statusJobId, meta.filePath, meta.fileName);
  },
  [JOB_TYPE_DIGEST_REGEN]: async (job) => {
    const entityType =
      typeof job.payload.entityType === "string" ? job.payload.entityType : "";
    const entityId =
      typeof job.payload.entityId === "string" ? job.payload.entityId : "";
    if (!entityType || !entityId) {
      throw new Error("digest_regen job missing entityType/entityId");
    }
    const { processDigestRegen } = await import("./digests");
    await processDigestRegen(job.userId, entityType, entityId);
  },
  [JOB_TYPE_ATTENTION_SCAN]: async (job) => {
    const noteId =
      typeof job.payload.noteId === "string" && job.payload.noteId
        ? job.payload.noteId
        : null;
    if (noteId) {
      const { scanNoteForDeadlines } = await import("./attention-extract");
      const result = await scanNoteForDeadlines(job.userId, noteId);
      logger.info({ userId: job.userId, noteId, ...result }, "Note deadline scan complete");
      return;
    }
    const { processAttentionScanJob } = await import("./attention-extract");
    const result = await processAttentionScanJob(job.userId);
    logger.info({ userId: job.userId, ...result }, "Attention scan complete");
  },
  [JOB_TYPE_WAITING_SCAN]: async (job) => {
    const { processWaitingScanJob } = await import("./waiting-extract");
    const scan = await processWaitingScanJob(job.userId);
    const { processWaitingOutcomesForUser } = await import("./waiting-outcomes");
    const outcomes = await processWaitingOutcomesForUser(job.userId);
    logger.info(
      { userId: job.userId, ...scan, ...outcomes },
      "Waiting scan complete",
    );
  },
};

async function runOneJob(job: Job): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    await failJob(job.id, `No handler registered for job type: ${job.type}`);
    return;
  }

  try {
    await handler(job);
    await completeJob(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    const terminal = await failJob(job.id, message);
    if (terminal && job.type === JOB_TYPE_CAPTURE_EXTRACTION) {
      const captureId = captureIdFromPayload(job.payload);
      if (captureId) {
        await updateCaptureStatusForUser(job.userId, captureId, {
          processedStatus: "failed",
          processingError: message,
        });
      }
    }
    logger.warn({ err, jobId: job.id, type: job.type, terminal }, "Background job failed");
  }
}

async function pollOnce(): Promise<void> {
  if (tickRunning) {
    wakeRequested = true;
    return;
  }
  tickRunning = true;
  try {
    ticks += 1;
    if (ticks % STALE_RECOVERY_EVERY_TICKS === 1) {
      const recovered = await recoverStaleProcessingJobs();
      if (recovered > 0) {
        logger.info({ recovered }, "Re-queued stale processing jobs");
      }
      try {
        const { expireDueMemories } = await import("./life-memory");
        const expired = await expireDueMemories(100);
        if (expired > 0) {
          logger.info({ expired }, "Marked due life memories as expired");
        }
      } catch (err) {
        logger.warn({ err }, "expireDueMemories failed");
      }
    }

    for (let i = 0; i < 3; i += 1) {
      const job = await claimNextJob(workerId);
      if (!job) break;
      await runOneJob(job);
    }
  } catch (err) {
    logger.warn({ err }, "Job worker tick failed");
  } finally {
    tickRunning = false;
    if (wakeRequested) {
      wakeRequested = false;
      void pollOnce();
    }
  }
}

/** Immediate + periodic drain for durable jobs. */
export function startJobWorker(): void {
  if (timer) return;
  void pollOnce();
  timer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
  timer.unref?.();
  logger.info({ workerId }, "Durable job worker started");
}

/** Call after enqueue so work starts without waiting for the next interval. */
export function nudgeJobWorker(): void {
  void pollOnce();
}

/** Test helper */
export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
