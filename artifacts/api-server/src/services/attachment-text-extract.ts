import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import OpenAI from "openai";
import { noteAttachments, notes } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { warmEntityEmbedding } from "./embedding-cache";
import { noteRetrievalText } from "./note-retrieval";
import { allowBackgroundAi, recordAiUsage, usageTokens } from "./ai-usage";

const MAX_EXTRACTED_CHARS = 12_000;
const MIN_IMAGE_BYTES_FOR_OCR = 2_500;
const MAX_IMAGE_BYTES_FOR_OCR = 8 * 1024 * 1024;
const BACKFILL_BATCH = 4;
const BACKFILL_TICK_MS = 15_000;
const BACKFILL_INITIAL_DELAY_MS = 45_000;

let backfillTimer: NodeJS.Timeout | null = null;
let backfillRunning = false;

function truncate(text: string, max = MAX_EXTRACTED_CHARS): string {
  const cleaned = text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
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

/**
 * Image detail sent to the vision model. "low" bills a flat, small number of
 * image tokens instead of scaling with resolution, which is the single biggest
 * lever on OCR cost. Extracted text only feeds search indexing, so the accuracy
 * trade is worth it by default; set OPENAI_OCR_DETAIL=high to restore fidelity.
 */
function ocrDetail(): "low" | "high" | "auto" {
  const raw = process.env.OPENAI_OCR_DETAIL?.trim().toLowerCase();
  return raw === "high" || raw === "auto" ? raw : "low";
}

/** OCR can run on a cheaper model than the main answer model. */
function ocrModel(): string {
  return (
    process.env.OPENAI_OCR_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function maxImageBytes(): number {
  const raw = Number(process.env.OCR_MAX_IMAGE_BYTES ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : MAX_IMAGE_BYTES_FOR_OCR;
}

async function extractImageText(
  data: Buffer,
  mimeType: string,
  userId?: string | null,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return "";
  if (data.length < MIN_IMAGE_BYTES_FOR_OCR) return "";
  if (data.length > maxImageBytes()) return "";
  if (!(await allowBackgroundAi("attachment_ocr"))) return "";

  const client = new OpenAI({ apiKey });
  const model = ocrModel();
  const b64 = data.toString("base64");
  const mime = mimeType.startsWith("image/") ? mimeType : "image/jpeg";

  const completion = await client.chat.completions.create({
    model,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all readable text from this image for search indexing. Include printed text and clear handwriting. Return only the extracted text with no commentary. If there is no text, return an empty string.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${b64}`, detail: ocrDetail() },
          },
        ],
      },
    ],
  });

  const tokens = usageTokens(completion.usage);
  await recordAiUsage({
    userId,
    feature: "attachment_ocr",
    model,
    background: true,
    ...tokens,
  });

  return truncate(completion.choices[0]?.message?.content ?? "");
}

/** Best-effort DOCX: unzip word/document.xml when `unzip` is available. */
async function extractDocxText(absPath: string): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "unzip",
      ["-p", absPath, "word/document.xml"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
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
  userId?: string | null;
}): Promise<string> {
  const mime = (opts.mimeType || "").toLowerCase();
  const name = (opts.fileName || "").toLowerCase();

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
    if (
      mime.includes("wordprocessingml") ||
      mime === "application/msword" ||
      name.endsWith(".docx")
    ) {
      return await extractDocxText(opts.absPath);
    }
    if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
      return await extractImageText(data, mime || "image/jpeg", opts.userId);
    }
  } catch (err) {
    logger.warn(
      { err, fileName: opts.fileName, mimeType: opts.mimeType },
      "Attachment text extraction failed",
    );
  }

  return "";
}

export async function persistAttachmentExtractedText(
  attachmentId: string,
  text: string,
): Promise<void> {
  await getDb()
    .update(noteAttachments)
    .set({
      extractedText: text || null,
      extractedAt: new Date(),
    })
    .where(eq(noteAttachments.id, attachmentId));
}

export async function extractAndStoreAttachmentText(attachmentId: string): Promise<string> {
  const rows = await getDb()
    .select()
    .from(noteAttachments)
    .where(eq(noteAttachments.id, attachmentId))
    .limit(1);
  const row = rows[0];
  if (!row) return "";

  // Another worker may have finished while this job was queued. Never bill twice.
  if (row.extractedAt) return row.extractedText ?? "";

  const absPath = path.join(config.attachmentsDir, row.storagePath);
  const text = await extractTextFromAttachmentFile({
    absPath,
    mimeType: row.mimeType,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    userId: row.userId,
  });
  await persistAttachmentExtractedText(attachmentId, text);

  const [note] = await getDb()
    .select()
    .from(notes)
    .where(eq(notes.id, row.noteId))
    .limit(1);
  if (note) {
    const attachmentText = await attachmentSearchTextForNotes([row.noteId]);
    warmEntityEmbedding(row.userId, {
      entityType: "note",
      entityId: row.noteId,
      text: noteRetrievalText({
        ...note,
        attachmentText: attachmentText.get(row.noteId) ?? "",
      }),
    });
  }
  return text;
}

/**
 * Deterministic job id for an attachment's OCR.
 * Job ids are the queue's only dedupe key, so this is what prevents the same
 * image from being charged more than once.
 */
export const OCR_JOB_PREFIX = "ocr-";

export function ocrJobId(attachmentId: string): string {
  return `${OCR_JOB_PREFIX}${attachmentId}`.slice(0, 64);
}

/** Queue extraction without blocking import/upload responses (durable Postgres jobs). */
export function queueAttachmentTextExtraction(
  attachmentIds: string[],
  userIdHint?: string,
): void {
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

        await enqueueJob({
          // Stable per attachment. OCR is billed per call, and the 15s backfill
          // re-selects rows that are still unprocessed, so a random id here let
          // the same image be sent to the vision model over and over.
          id: ocrJobId(attachmentId),
          userId,
          type: JOB_TYPE_ATTACHMENT_EXTRACT,
          payload: { attachmentId },
          maxAttempts: 3,
        });
      } catch (err) {
        logger.warn({ err, attachmentId }, "Failed to enqueue attachment extraction");
      }
    }
    nudgeJobWorker();
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

/** Enqueue pending OCR jobs (does not run extraction inline). */
export async function processPendingAttachmentExtractions(
  limit = BACKFILL_BATCH,
): Promise<number> {
  if (backfillRunning) return 0;
  backfillRunning = true;
  try {
    // Skip attachments that already have an OCR job of any status. Without this
    // the tick would keep re-selecting the same rows (the stable job id makes
    // re-enqueue a no-op) and never reach the rest of the backlog.
    const result = await getDb().execute(sql`
      SELECT a.id, a.user_id AS "userId"
      FROM note_attachments a
      WHERE a.extracted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM jobs j WHERE j.id = ${OCR_JOB_PREFIX} || a.id
        )
      LIMIT ${limit}
    `);
    type PendingRow = { id: string; userId: string };
    const raw = result as unknown as { rows?: PendingRow[] } | PendingRow[];
    const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);

    if (rows.length === 0) return 0;

    const byUser = new Map<string, string[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row.id);
      byUser.set(row.userId, list);
    }
    for (const [userId, ids] of byUser) {
      queueAttachmentTextExtraction(ids, userId);
    }
    if (rows.length > 0) {
      logger.info({ enqueued: rows.length }, "Attachment text backfill enqueued");
    }
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "Attachment text backfill tick failed");
    return 0;
  } finally {
    backfillRunning = false;
  }
}

export function startAttachmentTextBackfill(): void {
  if (backfillTimer) return;
  setTimeout(() => {
    void processPendingAttachmentExtractions();
  }, BACKFILL_INITIAL_DELAY_MS);
  backfillTimer = setInterval(() => {
    void processPendingAttachmentExtractions();
  }, BACKFILL_TICK_MS);
  backfillTimer.unref?.();
  logger.info("Attachment text extraction backfill started");
}
