import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../lib/config";
import type { EnexFileImportResult } from "./enex-import-runner";
import {
  cleanupUploadFile,
  importEnexFileForUser,
} from "./enex-import-runner";

export type ImportJobRecord = {
  userId: string;
  status: "processing" | "complete" | "failed";
  filePath?: string;
  fileName?: string;
  result?: EnexFileImportResult;
  error?: string;
  updatedAt: number;
};

const memory = new Map<string, ImportJobRecord>();
const activeJobs = new Set<string>();
const STALE_PROCESSING_MS = 3 * 60 * 1000;

function safeJobId(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe || safe !== jobId) {
    throw new Error("Invalid job id");
  }
  return safe;
}

function jobFilePath(userId: string, jobId: string): string {
  return path.join(config.uploadDir, userId, "jobs", `${safeJobId(jobId)}.json`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function persistJob(userId: string, jobId: string, job: ImportJobRecord): Promise<void> {
  const dir = path.join(config.uploadDir, userId, "jobs");
  await mkdir(dir, { recursive: true });
  await writeFile(jobFilePath(userId, jobId), JSON.stringify(job), "utf8");
  memory.set(jobId, job);
}

export async function createImportJob(
  userId: string,
  jobId: string,
  meta: { filePath: string; fileName: string },
): Promise<void> {
  await persistJob(userId, jobId, {
    userId,
    status: "processing",
    filePath: meta.filePath,
    fileName: meta.fileName,
    updatedAt: Date.now(),
  });
}

export async function completeImportJob(
  jobId: string,
  userId: string,
  result: EnexFileImportResult,
): Promise<void> {
  await persistJob(userId, jobId, {
    userId,
    status: "complete",
    result,
    updatedAt: Date.now(),
  });
}

export async function failImportJob(
  jobId: string,
  userId: string,
  error: string,
): Promise<void> {
  await persistJob(userId, jobId, {
    userId,
    status: "failed",
    error,
    updatedAt: Date.now(),
  });
}

export async function loadImportJob(
  jobId: string,
  userId: string,
): Promise<ImportJobRecord | null> {
  const cached = memory.get(jobId);
  if (cached && cached.userId === userId) {
    return cached;
  }

  try {
    const raw = await readFile(jobFilePath(userId, jobId), "utf8");
    const job = JSON.parse(raw) as ImportJobRecord;
    if (job.userId !== userId) return null;
    memory.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

function runImportWork(
  userId: string,
  jobId: string,
  filePath: string,
  fileName: string,
): void {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  void (async () => {
    try {
      const result = await importEnexFileForUser(userId, filePath, fileName);
      await completeImportJob(jobId, userId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      await failImportJob(jobId, userId, message);
    } finally {
      activeJobs.delete(jobId);
      await cleanupUploadFile(filePath);
    }
  })();
}

export async function startImportJob(
  userId: string,
  jobId: string,
  filePath: string,
  fileName: string,
): Promise<void> {
  await createImportJob(userId, jobId, { filePath, fileName });
  runImportWork(userId, jobId, filePath, fileName);
}

/** Load job status; resume processing imports after a server restart when possible. */
export async function ensureImportJob(
  jobId: string,
  userId: string,
): Promise<ImportJobRecord | null> {
  const job = await loadImportJob(jobId, userId);
  if (!job) return null;

  if (job.status !== "processing") {
    return job;
  }

  if (activeJobs.has(jobId)) {
    return job;
  }

  if (job.filePath && job.fileName && (await fileExists(job.filePath))) {
    runImportWork(userId, jobId, job.filePath, job.fileName);
    return job;
  }

  if (Date.now() - job.updatedAt > STALE_PROCESSING_MS) {
    await failImportJob(
      jobId,
      userId,
      "Import was interrupted. Check Notebooks — your notes may already be there.",
    );
    return loadImportJob(jobId, userId);
  }

  return job;
}
