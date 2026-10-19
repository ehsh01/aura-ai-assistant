import { readFile } from "node:fs/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { noteAttachments } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { isEnabled } from "../lib/feature-flags";
import { allowAttachmentOcrAi } from "./ai-usage";
import { attachmentContentHash } from "./attachment-text-extract";
import { getAttachmentForUser } from "./note-attachments";
import { createOpenAiClient } from "./openai-client";

const MAX_EXTRACTED_CHARS = 12_000;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let aiOcrQueue: Promise<void> = Promise.resolve();

export class AttachmentAiOcrError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function truncate(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function maxImageBytes(): number {
  const raw = Number(process.env.OCR_MAX_IMAGE_BYTES ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_IMAGE_BYTES;
}

function model(): string {
  return process.env.OPENAI_OCR_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function detail(): "low" | "high" | "auto" {
  const raw = process.env.OPENAI_OCR_DETAIL?.trim().toLowerCase();
  return raw === "high" || raw === "auto" ? raw : "low";
}

async function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = aiOcrQueue.then(work, work);
  aiOcrQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type AttachmentAiOcrResult = {
  text: string | null;
  cached: boolean;
};

/** Explicit user action only. There are no startup, timer, or queue entry points. */
export async function extractAttachmentTextWithAi(
  userId: string,
  attachmentId: string,
): Promise<AttachmentAiOcrResult> {
  return serialized(async () => {
    if (!isEnabled("RECALL_ATTACHMENT_OCR_ENABLED", false)) {
      throw new AttachmentAiOcrError("AI attachment OCR is disabled", 403, "AI_OCR_DISABLED");
    }

    const found = await getAttachmentForUser(userId, attachmentId);
    if (!found) {
      throw new AttachmentAiOcrError("Attachment not found", 404, "NOT_FOUND");
    }
    if (!found.row.mimeType.toLowerCase().startsWith("image/")) {
      throw new AttachmentAiOcrError("AI text extraction is available only for images", 400, "NOT_AN_IMAGE");
    }

    const data = await readFile(found.absPath);
    if (data.length > maxImageBytes()) {
      throw new AttachmentAiOcrError("Image is too large for AI OCR", 413, "IMAGE_TOO_LARGE");
    }

    const contentHash = attachmentContentHash(data);
    await getDb()
      .update(noteAttachments)
      .set({ contentHash })
      .where(and(eq(noteAttachments.id, attachmentId), eq(noteAttachments.userId, userId)));

    const [cached] = await getDb()
      .select({
        extractedText: noteAttachments.extractedText,
        aiOcrAt: noteAttachments.aiOcrAt,
      })
      .from(noteAttachments)
      .where(
        and(
          eq(noteAttachments.userId, userId),
          eq(noteAttachments.contentHash, contentHash),
          isNotNull(noteAttachments.aiOcrAt),
        ),
      )
      .limit(1);
    if (cached?.aiOcrAt) {
      await getDb()
        .update(noteAttachments)
        .set({
          extractedText: cached.extractedText,
          extractedAt: new Date(),
          aiOcrAt: cached.aiOcrAt,
        })
        .where(and(eq(noteAttachments.userId, userId), eq(noteAttachments.contentHash, contentHash)));
      return { text: cached.extractedText, cached: true };
    }

    const allowance = await allowAttachmentOcrAi(userId);
    if (!allowance.allowed) {
      const status = allowance.reason === "daily_limit" ? 429 : allowance.reason === "disabled" ? 403 : 503;
      const message =
        allowance.reason === "daily_limit"
          ? "Daily AI attachment OCR limit reached"
          : allowance.reason === "disabled"
            ? "AI attachment OCR is disabled"
            : "AI attachment OCR quota is temporarily unavailable";
      throw new AttachmentAiOcrError(message, status, `AI_OCR_${allowance.reason.toUpperCase()}`);
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new AttachmentAiOcrError("AI attachment OCR is unavailable", 503, "AI_OCR_UNAVAILABLE");
    }

    const selectedModel = model();
    const client = createOpenAiClient({
      apiKey,
      feature: "attachment_ocr_ai",
      userId,
      background: false,
      redactOutput: false,
    });
    const completion = await client.chat.completions.create({
      model: selectedModel,
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
              image_url: {
                url: `data:${found.row.mimeType};base64,${data.toString("base64")}`,
                detail: detail(),
              },
            },
          ],
        },
      ],
    });

    const text = truncate(completion.choices[0]?.message?.content ?? "") || null;
    const now = new Date();
    await getDb()
      .update(noteAttachments)
      .set({ extractedText: text, extractedAt: now, aiOcrAt: now })
      .where(and(eq(noteAttachments.userId, userId), eq(noteAttachments.contentHash, contentHash)));

    return { text, cached: false };
  });
}
