import { hostname } from "node:os";
import { logger } from "../lib/logger";
import { updateCaptureStatusForUser } from "./captures";
import {
  JOB_TYPE_ATTACHMENT_EXTRACT,
  JOB_TYPE_CAPTURE_EXTRACTION,
  JOB_TYPE_ENEX_IMPORT,
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
    const { extractAndStoreAttachmentText, persistAttachmentExtractedText } = await import(
      "./attachment-text-extract"
    );
    try {
      await extractAndStoreAttachmentText(attachmentId);
    } catch (err) {
      try {
        await persistAttachmentExtractedText(attachmentId, "");
      } catch {
        // ignore
      }
      throw err;
    }
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
