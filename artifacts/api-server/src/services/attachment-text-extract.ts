import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { noteAttachments } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { isEnabled } from "../lib/feature-flags";
import { isEvernoteNightWindow } from "./evernote-runtime-policy";
import {
  assertEvernoteImportSafe,
  evernoteDeferredError,
  requiredMemoryMbForBytes,
} from "./evernote-watchdog";

const MAX_EXTRACTED_CHARS = 12_000;
const MIN_IMAGE_BYTES_FOR_OCR = 2_500;
const MAX_IMAGE_BYTES_FOR_OCR = 8 * 1024 * 1024;
const DEFAULT_TESSERACT_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

let tesseractQueue: Promise<void> = Promise.resolve();
let loggedMissingTesseract = false;

export function attachmentContentHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function truncate(text: string, max = MAX_EXTRACTED_CHARS): string {
  const cleaned = text
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
}

async function extractPdfText(data: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdfParse = (mod as { default?: (buf: Buffer) => Promise<{ text?: string }> }).default ?? mod;
  const result = await (pdfParse as (buf: Buffer) => Promise<{ text?: string }>)(data);
  return truncate(result?.text ?? "");
}

async function extractPlainText(data: Buffer, mimeType: string): Promise<string> {
  const raw = data.toString("utf8");
  if (mimeType.includes("html") || mimeType.includes("xml")) {
    return truncate(stripHtml(raw));
  }
  return truncate(raw);
}

function maxImageBytes(): number {
  const raw = Number(process.env.OCR_MAX_IMAGE_BYTES ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : MAX_IMAGE_BYTES_FOR_OCR;
}

function tesseractTimeoutMs(): number {
  const raw = Number(process.env.TESSERACT_OCR_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TESSERACT_TIMEOUT_MS;
}

function serializeTesseract<T>(work: () => Promise<T>): Promise<T> {
  const run = tesseractQueue.then(work, work);
  tesseractQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isMissingExecutable(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT") {
    return true;
  }
  const detail =
    typeof err === "object" && err !== null && "stderr" in err
      ? String((err as { stderr?: unknown }).stderr)
      : err instanceof Error
        ? err.message
        : "";
  return (
    /(?:failed to execute|not found|no such file).*\btesseract\b/i.test(detail) ||
    /\btesseract\b.*(?:not found|no such file)/i.test(detail)
  );
}

/** Free, out-of-process OCR. Serialized to protect low-memory production hosts. */
export async function extractImageTextWithTesseract(
  absPath: string,
  sizeBytes: number,
  run: typeof execFileAsync = execFileAsync,
  options?: {
    now?: Date;
    loadCheck?: (sizeBytes: number) => Promise<void>;
  },
): Promise<string> {
  if (sizeBytes < MIN_IMAGE_BYTES_FOR_OCR || sizeBytes > maxImageBytes()) return "";
  if (!isEnabled("RECALL_ATTACHMENT_OCR_ENABLED", false)) {
    throw evernoteDeferredError("upload OCR is disabled", 60 * 60_000);
  }
  if (!isEvernoteNightWindow(options?.now)) {
    throw evernoteDeferredError(
      "upload OCR is outside the configured night window",
      60 * 60_000,
    );
  }

  return serializeTesseract(async () => {
    await (
      options?.loadCheck ??
      (async (bytes: number) =>
        assertEvernoteImportSafe({
          minimumMemoryMb: requiredMemoryMbForBytes(bytes),
          requireMemoryMeasurement: true,
        }))
    )(sizeBytes);
    try {
      // `flock` makes the concurrency cap host-wide across API/worker PM2
      // processes; the in-process queue avoids needless lock contention.
      const { stdout } = await run(
        "nice",
        [
          "-n",
          "19",
          "flock",
          "-x",
          "-F",
          "/tmp/recall-tesseract.lock",
          "tesseract",
          absPath,
          "stdout",
        ],
        {
          timeout: tesseractTimeoutMs(),
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        },
      );
      return truncate(String(stdout));
    } catch (err) {
      if (isMissingExecutable(err)) {
        if (!loggedMissingTesseract) {
          loggedMissingTesseract = true;
          logger.warn("tesseract binary is unavailable; image attachment text extraction is disabled");
        }
        throw err;
      }
      logger.warn({ err, absPath }, "Tesseract attachment extraction failed");
      throw err;
    }
  });
}

/** Best-effort DOCX: unzip word/document.xml when `unzip` is available. */
async function extractDocxText(absPath: string): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("unzip", ["-p", absPath, "word/document.xml"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return truncate(stripHtml(String(stdout)));
  } catch {
    return "";
  }
}

export async function extractTextFromAttachmentFile(opts: {
  absPath: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}): Promise<string> {
  const mime = (opts.mimeType || "").toLowerCase();
  const name = (opts.fileName || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
    // Let night/load deferrals propagate to the durable job. Persisting an
    // empty extraction here would permanently drop the queued upload OCR.
    return extractImageTextWithTesseract(opts.absPath, opts.sizeBytes);
  }

  let data: Buffer;
  try {
    data = await readFile(opts.absPath);
  } catch {
    return "";
  }

  try {
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      return await extractPdfText(data);
    }
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      mime === "application/xml" ||
      name.endsWith(".txt") ||
      name.endsWith(".csv") ||
      name.endsWith(".md") ||
      name.endsWith(".html")
    ) {
      return await extractPlainText(data, mime || "text/plain");
    }
    if (mime.includes("wordprocessingml") || mime === "application/msword" || name.endsWith(".docx")) {
      return await extractDocxText(opts.absPath);
    }
  } catch (err) {
    logger.warn({ err, fileName: opts.fileName, mimeType: opts.mimeType }, "Attachment text extraction failed");
  }

  return "";
}

export async function persistAttachmentExtractedText(attachmentId: string, text: string | null): Promise<void> {
  await getDb()
    .update(noteAttachments)
    .set({
      extractedText: text || null,
      extractedAt: new Date(),
    })
    .where(eq(noteAttachments.id, attachmentId));
}

export type CachedExtraction = {
  processed: boolean;
  text: string | null;
};

/**
 * Small testable cache boundary: a completed hash (including an empty result)
 * never invokes the extractor again.
 */
export async function extractWithContentHashCache(opts: {
  findCached: () => Promise<CachedExtraction>;
  extract: () => Promise<string>;
}): Promise<{ text: string | null; cached: boolean }> {
  const cached = await opts.findCached();
  if (cached.processed) return { text: cached.text, cached: true };
  const text = (await opts.extract()) || null;
  return { text, cached: false };
}

export async function extractAndStoreAttachmentText(attachmentId: string): Promise<string> {
  const rows = await getDb().select().from(noteAttachments).where(eq(noteAttachments.id, attachmentId)).limit(1);
  const row = rows[0];
  if (!row) return "";

  // Another worker may have finished while this job was queued. Never bill twice.
  if (row.extractedAt) return row.extractedText ?? "";

  const absPath = path.join(config.attachmentsDir, row.storagePath);
  let contentHash: string | null = null;
  try {
    contentHash = attachmentContentHash(await readFile(absPath));
    await getDb().update(noteAttachments).set({ contentHash }).where(eq(noteAttachments.id, attachmentId));
  } catch {
    // A missing/unreadable file follows the existing extraction failure path.
  }

  const result = await extractWithContentHashCache({
    findCached: async () => {
      if (!contentHash) return { processed: false, text: null };
      try {
        const [reusable] = await getDb()
          .select({
            extractedText: noteAttachments.extractedText,
            extractedAt: noteAttachments.extractedAt,
          })
          .from(noteAttachments)
          .where(
            and(
              eq(noteAttachments.userId, row.userId),
              eq(noteAttachments.contentHash, contentHash),
              isNotNull(noteAttachments.extractedAt),
            ),
          )
          .limit(1);
        return reusable?.extractedAt
          ? { processed: true, text: reusable.extractedText }
          : { processed: false, text: null };
      } catch {
        // Cache lookup is best-effort; extraction remains available.
        return { processed: false, text: null };
      }
    },
    extract: () =>
      extractTextFromAttachmentFile({
        absPath,
        mimeType: row.mimeType,
        fileName: row.fileName,
        sizeBytes: row.sizeBytes,
      }),
  });
  await persistAttachmentExtractedText(attachmentId, result.text);
  return result.text ?? "";
}

/** Deterministic upload-time extraction job id. */
export const ATTACHMENT_TEXT_JOB_PREFIX = "attachment-text-";

export function attachmentTextJobId(attachmentId: string): string {
  return `${ATTACHMENT_TEXT_JOB_PREFIX}${attachmentId}`.slice(0, 64);
}

/** Queue one local extraction when an attachment is saved. */
export function queueAttachmentTextExtraction(attachmentIds: string[], userIdHint?: string): void {
  if (attachmentIds.length === 0) return;
  void (async () => {
    const { enqueueJob, JOB_TYPE_ATTACHMENT_EXTRACT } = await import("./job-queue");
    const { nudgeJobWorker } = await import("./job-worker");

    for (const attachmentId of attachmentIds) {
      try {
        let userId = userIdHint;
        if (!userId) {
          const rows = await getDb()
            .select({ userId: noteAttachments.userId })
            .from(noteAttachments)
            .where(eq(noteAttachments.id, attachmentId))
            .limit(1);
          userId = rows[0]?.userId;
        }
        if (!userId) continue;

        const job = await enqueueJob({
          id: attachmentTextJobId(attachmentId),
          userId,
          type: JOB_TYPE_ATTACHMENT_EXTRACT,
          payload: { attachmentId },
          maxAttempts: 3,
        });
        nudgeJobWorker(job.id);
      } catch (err) {
        logger.warn({ err, attachmentId }, "Failed to enqueue attachment extraction");
      }
    }
  })();
}

/**
 * Aggregate searchable attachment text for a note (filenames + extracted body).
 * Capped for list/search payloads.
 */
export async function attachmentSearchTextForNotes(
  noteIds: string[],
  maxCharsPerNote = 4_000,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (noteIds.length === 0) return out;

  const attRows = await getDb()
    .select({
      noteId: noteAttachments.noteId,
      fileName: noteAttachments.fileName,
      extractedText: noteAttachments.extractedText,
    })
    .from(noteAttachments)
    .where(inArray(noteAttachments.noteId, noteIds));

  for (const row of attRows) {
    const parts: string[] = [];
    if (row.fileName?.trim()) parts.push(row.fileName.trim());
    if (row.extractedText?.trim()) parts.push(row.extractedText.trim());
    if (parts.length === 0) continue;
    const chunk = parts.join("\n");
    const prev = out.get(row.noteId) ?? "";
    const next = prev ? `${prev}\n${chunk}` : chunk;
    out.set(row.noteId, next.length > maxCharsPerNote ? next.slice(0, maxCharsPerNote) : next);
  }

  return out;
}
