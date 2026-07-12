import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, isNull } from "drizzle-orm";
import OpenAI from "openai";
import { noteAttachments } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

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

async function extractImageText(data: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return "";
  if (data.length < MIN_IMAGE_BYTES_FOR_OCR) return "";
  if (data.length > MAX_IMAGE_BYTES_FOR_OCR) return "";

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
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
            image_url: { url: `data:${mime};base64,${b64}` },
          },
        ],
      },
    ],
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
      return await extractImageText(data, mime || "image/jpeg");
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

  const absPath = path.join(config.attachmentsDir, row.storagePath);
  const text = await extractTextFromAttachmentFile({
    absPath,
    mimeType: row.mimeType,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
  });
  await persistAttachmentExtractedText(attachmentId, text);
  return text;
}

/** Queue extraction without blocking import/upload responses. */
export function queueAttachmentTextExtraction(attachmentIds: string[]): void {
  if (attachmentIds.length === 0) return;
  void (async () => {
    for (const id of attachmentIds) {
      try {
        await extractAndStoreAttachmentText(id);
      } catch (err) {
        logger.warn({ err, attachmentId: id }, "Queued attachment extraction failed");
        try {
          await persistAttachmentExtractedText(id, "");
        } catch {
          // ignore
        }
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

export async function processPendingAttachmentExtractions(
  limit = BACKFILL_BATCH,
): Promise<number> {
  if (backfillRunning) return 0;
  backfillRunning = true;
  try {
    const rows = await getDb()
      .select({ id: noteAttachments.id })
      .from(noteAttachments)
      .where(isNull(noteAttachments.extractedAt))
      .limit(limit);

    let done = 0;
    for (const row of rows) {
      try {
        await extractAndStoreAttachmentText(row.id);
        done += 1;
      } catch (err) {
        logger.warn({ err, attachmentId: row.id }, "Backfill attachment extraction failed");
        try {
          await persistAttachmentExtractedText(row.id, "");
        } catch {
          // ignore
        }
      }
    }
    if (done > 0) {
      logger.info({ processed: done, remainingBatch: rows.length }, "Attachment text backfill tick");
    }
    return done;
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
