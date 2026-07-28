import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { people, sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import { aiService, type WaitingCommitment } from "./ai";
import {
  upsertWaitingItemForUser,
  type WaitingItemDto,
} from "./waiting-items";
import { dueAtFromDateString } from "./attention";
import { EXTRACT_WAITING_PROMPT_VERSION } from "../prompts/extractWaiting.v1";

/** Only auto-create durable items when the promise is explicit. */
const AUTO_CREATE_CONFIDENCE = 0.7;

/**
 * Cheap pre-filter so the LLM only sees plausible promise emails. Cue phrases
 * for someone committing to deliver: "I'll send", "we can schedule",
 * "will be ready by", "within 2 weeks", etc.
 */
export const WAITING_CUE_RE =
  /\b(i'?ll|i will|we'?ll|we will|we can|i can|will send|i'?ll send|send you|get back to you|follow up with you|schedule|arrange|take care of|handle|prepare|draft|process|submit|deliver|attach|forward|ready by|by (mon|tue|wed|thur|fri|sat|sun)|within \d+|as soon as possible|asap)\b/i;

export function hasWaitingCues(text: string): boolean {
  return WAITING_CUE_RE.test(text);
}

/** Inbound = sender exists and is not the synced mailbox owner. */
export function isInboundGmailRecord(meta: Record<string, unknown>): boolean {
  const sender =
    typeof meta.senderEmail === "string" ? meta.senderEmail.trim().toLowerCase() : "";
  if (!sender) return false;
  const mailbox =
    typeof meta.mailbox === "string" ? meta.mailbox.trim().toLowerCase() : "";
  return mailbox ? sender !== mailbox : true;
}

export function isWaitingScanned(meta: Record<string, unknown>): boolean {
  return typeof meta.waitingScanAt === "string" && Boolean(meta.waitingScanAt);
}

export async function markSourceScannedForWaiting(
  sourceRecordId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE source_records
    SET
      record_metadata = COALESCE(record_metadata, '{}'::jsonb)
        || jsonb_build_object('waitingScanAt', ${new Date().toISOString()}),
      updated_at = now()
    WHERE id = ${sourceRecordId}
  `);
}

export async function listUnscannedGmailForWaiting(
  userId: string,
  limit = 15,
): Promise<typeof sourceRecords.$inferSelect[]> {
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "gmail_message"),
      ),
    )
    .orderBy(desc(sourceRecords.sourceCreatedAt))
    .limit(Math.min(limit * 4, 80));

  return rows
    .filter((r) => {
      const meta = (r.recordMetadata ?? {}) as Record<string, unknown>;
      if (isWaitingScanned(meta)) return false;
      if (!isInboundGmailRecord(meta)) return false;
      const blob = `${r.recordTitle ?? ""}\n${(r.recordText ?? "").slice(0, 3000)}`;
      return hasWaitingCues(blob);
    })
    .slice(0, limit);
}

function parseFromField(recordText: string | null): { name: string; email: string } {
  const text = recordText ?? "";
  const senderName = text.match(/sender_name:\s*(.+)/i)?.[1]?.trim() ?? "";
  const senderEmail = text.match(/sender_email:\s*(\S+)/i)?.[1]?.trim() ?? "";
  if (senderName || senderEmail) return { name: senderName, email: senderEmail };
  const fromLine = text.match(/^From:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const angle = fromLine.match(/^(.*?)\s*<([^>]+)>/);
  if (angle) {
    return {
      name: angle[1]!.replace(/^["']|["']$/g, "").trim(),
      email: angle[2]!.trim().toLowerCase(),
    };
  }
  if (fromLine.includes("@")) return { name: "", email: fromLine.toLowerCase() };
  return { name: fromLine, email: "" };
}

/** Link an existing People row when the owner matches; never auto-create. */
async function findOwnerPersonId(
  userId: string,
  name: string,
  email: string | null,
): Promise<string | null> {
  const trimmed = name.trim();
  const conditions = [];
  if (trimmed.length >= 3) conditions.push(ilike(people.displayName, trimmed));
  if (email) conditions.push(ilike(people.email, email));
  if (conditions.length === 0) return null;
  const rows = await getDb()
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.userId, userId), or(...conditions)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Run waiting-commitment extraction over one source record and upsert durable
 * items (dedupe by fingerprint). Used by the post-sync scan and by the manual
 * "track this" route.
 */
export async function extractWaitingFromRecord(
  userId: string,
  row: typeof sourceRecords.$inferSelect,
  opts?: { minConfidence?: number },
): Promise<{ created: number; items: WaitingItemDto[] }> {
  const meta = (row.recordMetadata ?? {}) as Record<string, unknown>;
  const from = parseFromField(row.recordText);
  const extracted = await aiService.extractWaitingCommitments({
    subject: row.recordTitle ?? "(no subject)",
    body: row.recordText ?? "",
    fromName: from.name || (typeof meta.senderName === "string" ? meta.senderName : null),
    fromEmail: from.email || (typeof meta.senderEmail === "string" ? meta.senderEmail : null),
  });

  const minConfidence = opts?.minConfidence ?? AUTO_CREATE_CONFIDENCE;
  const items: WaitingItemDto[] = [];
  let created = 0;

  for (const c of extracted.commitments) {
    try {
      const item = await commitmentToWaitingItem(userId, row, c, from, meta, minConfidence);
      if (!item) continue;
      items.push(item.item);
      if (item.created) created += 1;
    } catch (err) {
      logger.warn({ err, sourceRecordId: row.id }, "Waiting commitment upsert failed");
    }
  }
  return { created, items };
}

/**
 * Map LLM-extracted commitment dates. promisedAt may be in the past (the
 * email date is a factual fallback); expectedAt only when explicitly stated —
 * uncertain/none confidence never produces a deadline.
 */
export function mapCommitmentDates(
  c: Pick<WaitingCommitment, "promisedAt" | "expectedAt" | "dateConfidence">,
  sourceCreatedAt: Date | null,
): {
  promisedAt: Date | null;
  expectedAt: Date | null;
  dateConfidence: "certain" | "uncertain" | "none";
} {
  const promisedAt =
    (c.promisedAt ? dueAtFromDateString(c.promisedAt) : null) ?? sourceCreatedAt;
  const expectedAt =
    c.dateConfidence !== "none" && c.expectedAt
      ? dueAtFromDateString(c.expectedAt)
      : null;
  return {
    promisedAt,
    expectedAt,
    dateConfidence: expectedAt ? c.dateConfidence : "none",
  };
}

async function commitmentToWaitingItem(
  userId: string,
  row: typeof sourceRecords.$inferSelect,
  c: WaitingCommitment,
  from: { name: string; email: string },
  meta: Record<string, unknown>,
  minConfidence: number,
): Promise<{ item: WaitingItemDto; created: boolean } | null> {
  if (c.confidence < minConfidence) return null;
  const ownerName = (c.ownerName?.trim() || from.name || from.email || "Unknown").slice(0, 200);
  if (!ownerName) return null;

  const { promisedAt, expectedAt, dateConfidence } = mapCommitmentDates(
    c,
    row.sourceCreatedAt,
  );

  const threadId =
    typeof meta.threadId === "string" && meta.threadId ? meta.threadId : null;
  const ownerPersonId = await findOwnerPersonId(userId, ownerName, from.email || null);

  return upsertWaitingItemForUser(userId, {
    ownerName,
    ownerOrg: c.ownerOrg?.trim().slice(0, 200) || null,
    ownerPersonId,
    deliverable: c.deliverable,
    promisedAt,
    expectedAt,
    dateConfidence,
    confidence: c.confidence,
    threadId,
    sourceEntityType: "source_record",
    sourceEntityId: row.id,
    evidenceText: c.evidenceText,
    evidenceSnippet: c.evidenceText,
    metadata: {
      extractedFrom: "gmail_message",
      promptVersion: EXTRACT_WAITING_PROMPT_VERSION,
      externalId: row.externalId,
      sourceUrl: row.sourceUrl ?? null,
      ownerEmail: from.email || null,
    },
  });
}

/** Post-sync scan: keyword-filtered inbound Gmail → LLM extraction. */
export async function scanGmailForWaitingItems(
  userId: string,
  opts?: { limit?: number },
): Promise<{ scanned: number; created: number; items: WaitingItemDto[] }> {
  const limit = opts?.limit ?? 15;
  const rows = await listUnscannedGmailForWaiting(userId, limit);
  const items: WaitingItemDto[] = [];
  let created = 0;

  for (const row of rows) {
    try {
      const result = await extractWaitingFromRecord(userId, row);
      await markSourceScannedForWaiting(row.id);
      items.push(...result.items);
      created += result.created;
    } catch (err) {
      logger.warn({ err, sourceRecordId: row.id }, "Waiting extract failed for record");
      try {
        await markSourceScannedForWaiting(row.id);
      } catch {
        /* ignore */
      }
    }
  }

  return { scanned: rows.length, created, items };
}

/** Manual "track this source" — bypasses the cue pre-filter and scan flag. */
export async function extractWaitingForSource(
  userId: string,
  sourceRecordId: string,
): Promise<{ created: number; items: WaitingItemDto[] } | null> {
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(and(eq(sourceRecords.id, sourceRecordId), eq(sourceRecords.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const result = await extractWaitingFromRecord(userId, row, { minConfidence: 0.4 });
  try {
    await markSourceScannedForWaiting(row.id);
  } catch {
    /* ignore */
  }
  return result;
}

/** Post-sync waiting job: extract new commitments from inbound Gmail. */
export async function processWaitingScanJob(
  userId: string,
): Promise<{ gmailCreated: number; gmailScanned: number }> {
  const mail = await scanGmailForWaitingItems(userId);
  return { gmailCreated: mail.created, gmailScanned: mail.scanned };
}
