import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { captures, lifeMemories, notes } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { aiService } from "./ai";
import { enqueueJob, JOB_TYPE_DIGEST_REGEN } from "./job-queue";

const DIGEST_MAX = 560;
const BULLET_MAX = 8;

export function digestContentHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/** Fast extractive digest — no LLM. Used as fallback and for short texts. */
export function heuristicDigest(title: string, body: string, max = DIGEST_MAX): string {
  const plain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return title.trim().slice(0, max);
  const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
  let out = "";
  for (const s of sentences.length ? sentences : [plain]) {
    if (out.length + s.length + 1 > max) break;
    out = out ? `${out} ${s}` : s;
  }
  if (!out) out = plain.slice(0, max);
  return out.slice(0, max);
}

export function heuristicFactBullets(body: string): string[] {
  const plain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lines = plain
    .split(/[\n•\-\u2022]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && l.length <= 160);
  const bullets: string[] = [];
  for (const line of lines) {
    if (bullets.length >= BULLET_MAX) break;
    if (!bullets.includes(line)) bullets.push(line);
  }
  if (bullets.length === 0 && plain.length > 40) {
    bullets.push(plain.slice(0, 140));
  }
  return bullets.slice(0, BULLET_MAX);
}

async function maybeAiDigest(title: string, body: string): Promise<string | null> {
  if (aiService.getStatus().degraded) return null;
  if (typeof aiService.chat !== "function") return null;
  if (body.trim().length < 800) return null;
  try {
    const result = await aiService.chat({
      messages: [
        {
          role: "system",
          content:
            "Summarize personal notes into a dense factual digest under 500 characters. " +
            "Keep names, dates, amounts, IDs, VINs, and concrete facts. No fluff. Plain text only.",
        },
        {
          role: "user",
          content: `Title: ${title.slice(0, 200)}\n\n${body.slice(0, 6_000)}`,
        },
      ],
    });
    const text = (result.message?.content ?? "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, DIGEST_MAX) : null;
  } catch {
    return null;
  }
}

export async function enqueueDigestRegen(input: {
  userId: string;
  entityType: "note" | "memory" | "capture" | "document" | "source_record";
  entityId: string;
}): Promise<void> {
  await enqueueJob({
    userId: input.userId,
    type: JOB_TYPE_DIGEST_REGEN,
    payload: {
      entityType: input.entityType,
      entityId: input.entityId,
    },
    maxAttempts: 2,
  });
}

export function scheduleDigestRegen(input: {
  userId: string;
  entityType: "note" | "memory" | "capture" | "document" | "source_record";
  entityId: string;
}): void {
  void enqueueDigestRegen(input).catch(() => {
    // Best-effort; Ask still works on full text.
  });
}

export async function processDigestRegen(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (entityType === "note") {
    await regenerateNoteDigest(userId, entityId);
    return;
  }
  if (entityType === "memory") {
    await regenerateMemoryDigest(userId, entityId);
    return;
  }
  if (entityType === "capture") {
    await regenerateCaptureDigest(userId, entityId);
    return;
  }
  if (entityType === "document") {
    await regenerateDocumentDigest(userId, entityId);
  }
  // source_record digests live in record_metadata — handled at sync/live-fetch time.
}

export async function regenerateNoteDigest(userId: string, noteId: string): Promise<void> {
  const rows = await getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const hash = digestContentHash([row.title, row.content]);
  if (row.contentHash === hash && row.summary?.trim()) return;

  const ai = await maybeAiDigest(row.title, row.content);
  const summary = ai ?? heuristicDigest(row.title, row.content);
  const factBullets = heuristicFactBullets(row.content);

  await getDb()
    .update(notes)
    .set({
      summary,
      contentHash: hash,
      factBullets,
      updatedAt: new Date(),
    })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
}

export async function regenerateMemoryDigest(
  userId: string,
  memoryId: string,
): Promise<void> {
  const rows = await getDb()
    .select()
    .from(lifeMemories)
    .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.content.length <= 800) {
    if (row.summary) {
      await getDb()
        .update(lifeMemories)
        .set({ summary: null, updatedAt: new Date() })
        .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)));
    }
    return;
  }
  const ai = await maybeAiDigest(row.title, row.content);
  const summary = ai ?? heuristicDigest(row.title, row.content);
  await getDb()
    .update(lifeMemories)
    .set({ summary, updatedAt: new Date() })
    .where(and(eq(lifeMemories.id, memoryId), eq(lifeMemories.userId, userId)));
}

export async function regenerateCaptureDigest(
  userId: string,
  captureId: string,
): Promise<void> {
  const rows = await getDb()
    .select()
    .from(captures)
    .where(and(eq(captures.id, captureId), eq(captures.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const title = row.title || "Capture";
  const ai = await maybeAiDigest(title, row.rawText);
  const digest = ai ?? heuristicDigest(title, row.rawText, 400);
  await getDb()
    .update(captures)
    .set({ digest, updatedAt: new Date() })
    .where(and(eq(captures.id, captureId), eq(captures.userId, userId)));
}

async function regenerateDocumentDigest(userId: string, documentId: string): Promise<void> {
  const { documents } = await import("@workspace/db/schema");
  const rows = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.summary?.trim()) return;
  const body = row.extractedText ?? "";
  if (!body.trim()) return;
  const ai = await maybeAiDigest(row.fileName, body);
  const summary = ai ?? heuristicDigest(row.fileName, body);
  await getDb()
    .update(documents)
    .set({ summary, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
}

/** Persist Ask digest onto a source_record metadata blob (mail/Drive). */
export function withSourceDigest(
  metadata: Record<string, unknown> | null | undefined,
  digest: string,
): Record<string, unknown> {
  return { ...(metadata ?? {}), digest: digest.slice(0, DIGEST_MAX) };
}
