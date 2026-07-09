import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../lib/config";

export type ExtractionJobRecord = {
  userId: string;
  captureId: string;
  status: "queued" | "processing" | "complete" | "failed";
  error?: string;
  updatedAt: number;
};

const memory = new Map<string, ExtractionJobRecord>();
const activeJobs = new Set<string>();

function jobFilePath(userId: string, jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(config.uploadDir, userId, "extraction-jobs", `${safe}.json`);
}

async function persistJob(userId: string, jobId: string, job: ExtractionJobRecord): Promise<void> {
  const dir = path.join(config.uploadDir, userId, "extraction-jobs");
  await mkdir(dir, { recursive: true });
  await writeFile(jobFilePath(userId, jobId), JSON.stringify(job), "utf8");
  memory.set(jobId, job);
}

export async function createExtractionJob(
  userId: string,
  jobId: string,
  captureId: string,
): Promise<void> {
  await persistJob(userId, jobId, {
    userId,
    captureId,
    status: "queued",
    updatedAt: Date.now(),
  });
}

export async function markExtractionJobProcessing(jobId: string): Promise<void> {
  const job = memory.get(jobId);
  if (!job) return;
  job.status = "processing";
  job.updatedAt = Date.now();
  await persistJob(job.userId, jobId, job);
}

export async function completeExtractionJob(jobId: string): Promise<void> {
  const job = memory.get(jobId);
  if (!job) return;
  job.status = "complete";
  job.updatedAt = Date.now();
  await persistJob(job.userId, jobId, job);
  activeJobs.delete(jobId);
}

export async function failExtractionJob(jobId: string, error: string): Promise<void> {
  const job = memory.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.error = error;
  job.updatedAt = Date.now();
  await persistJob(job.userId, jobId, job);
  activeJobs.delete(jobId);
}

export async function getExtractionJob(jobId: string): Promise<ExtractionJobRecord | null> {
  if (memory.has(jobId)) return memory.get(jobId)!;
  for (const [uid] of memory) {
    void uid;
  }
  try {
    const entries = memory.values();
    for (const j of entries) {
      if (j.captureId === jobId) return j;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadExtractionJob(
  userId: string,
  jobId: string,
): Promise<ExtractionJobRecord | null> {
  if (memory.has(jobId)) return memory.get(jobId)!;
  try {
    const raw = await readFile(jobFilePath(userId, jobId), "utf8");
    const job = JSON.parse(raw) as ExtractionJobRecord;
    memory.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

export function tryAcquireExtractionJob(jobId: string): boolean {
  if (activeJobs.has(jobId)) return false;
  activeJobs.add(jobId);
  return true;
}

export function releaseExtractionJob(jobId: string): void {
  activeJobs.delete(jobId);
}
