import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { sourceRecords, waitingItems, type WaitingItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import { aiService, type WaitingReplyOutcome } from "./ai";
import { createEvidenceForUser } from "./evidence";
import { writeAuditLog } from "./audit";
import { defaultFollowUpAt, type DateConfidence } from "./waiting-items";
import { isAutomatedGmailRecord, isInboundGmailRecord } from "./waiting-extract";
import { dueAtFromDateString } from "./attention";
import { CLASSIFY_WAITING_REPLY_PROMPT_VERSION } from "../prompts/classifyWaitingReply.v1";

export type WaitingMatchType = "thread" | "sender" | "subject";

export type ReplyContext = {
  threadId: string | null;
  senderEmail: string | null;
  subject: string;
};

/** Strip reply/forward markers and noise for subject matching. */
export function normalizeSubjectForMatch(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a new inbound reply to an open commitment. Precedence: Gmail threadId
 * (most reliable), then sender email, then normalized subject overlap.
 */
export function matchWaitingItemForReply<T extends WaitingItem>(
  items: T[],
  reply: ReplyContext,
): { item: T; matchType: WaitingMatchType } | null {
  if (reply.threadId) {
    const hit = items.find((i) => i.threadId && i.threadId === reply.threadId);
    if (hit) return { item: hit, matchType: "thread" };
  }

  const sender = reply.senderEmail?.trim().toLowerCase() || null;
  if (sender) {
    const hit = items.find((i) => {
      const ownerEmail =
        typeof i.metadata?.ownerEmail === "string"
          ? i.metadata.ownerEmail.trim().toLowerCase()
          : null;
      return ownerEmail === sender;
    });
    if (hit) return { item: hit, matchType: "sender" };
  }

  const subjectNorm = normalizeSubjectForMatch(reply.subject);
  if (subjectNorm.length >= 8) {
    const hit = items.find((i) => {
      const deliverableNorm = normalizeSubjectForMatch(i.deliverable);
      const sourceSubject =
        typeof i.metadata?.sourceSubject === "string"
          ? normalizeSubjectForMatch(i.metadata.sourceSubject)
          : "";
      return (
        (deliverableNorm.length >= 8 && subjectNorm.includes(deliverableNorm)) ||
        (sourceSubject.length >= 8 &&
          (subjectNorm.includes(sourceSubject) || sourceSubject.includes(subjectNorm)))
      );
    });
    if (hit) return { item: hit, matchType: "subject" };
  }

  return null;
}

export type OutcomeApplication = "complete" | "suggest_resolve" | "revise" | "note" | "review";

/**
 * Auto-apply policy: only very-high-confidence completions close the item;
 * plausible completions become a user-confirmed suggestion; revisions and
 * still-waiting notes are low-risk; anything unclear goes to human review.
 */
export function decideOutcomeApplication(
  outcome: WaitingReplyOutcome,
  confidence: number,
): OutcomeApplication {
  if (outcome === "completed") {
    if (confidence >= 0.9) return "complete";
    if (confidence >= 0.55) return "suggest_resolve";
    return "review";
  }
  if (outcome === "revised_delayed" && confidence >= 0.6) return "revise";
  if (outcome === "still_waiting" && confidence >= 0.5) return "note";
  return "review";
}

/**
 * Recompute dates after a revised/delayed reply: a new explicit date becomes
 * the expected date and the next follow-up; without one, fall back to the
 * standard default (never invents a deadline).
 */
export function computeRevisedDates(input: {
  revisedExpectedAt: string | null;
  currentExpectedAt: Date | null;
  promisedAt: Date | null;
  dateConfidence: DateConfidence;
  now?: Date;
}): { expectedAt: Date | null; followUpAt: Date | null; dateConfidence: DateConfidence } {
  const revised = input.revisedExpectedAt
    ? dueAtFromDateString(input.revisedExpectedAt)
    : null;
  if (revised) {
    return { expectedAt: revised, followUpAt: revised, dateConfidence: "certain" };
  }
  return {
    expectedAt: input.currentExpectedAt,
    followUpAt: defaultFollowUpAt({
      promisedAt: input.promisedAt,
      expectedAt: input.currentExpectedAt,
      dateConfidence: input.dateConfidence,
      now: input.now,
    }).at,
    dateConfidence: input.dateConfidence,
  };
}

const OUTCOME_AUDIT_ACTION: Record<WaitingReplyOutcome, string> = {
  completed: "waiting_reply_completed",
  revised_delayed: "waiting_reply_revised",
  still_waiting: "waiting_reply_still_waiting",
  unclear: "waiting_reply_unclear",
};

export async function listUnprocessedInboundReplies(
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
      if (typeof meta.waitingOutcomeScanAt === "string" && meta.waitingOutcomeScanAt) {
        return false;
      }
      if (!isInboundGmailRecord(meta)) return false;
      // Newsletters/automated mail can never be a reply that resolves a
      // commitment — excluding them also keeps LLM costs down.
      return !isAutomatedGmailRecord(meta, r.recordText ?? "");
    })
    .slice(0, limit);
}

export async function markSourceScannedForWaitingOutcome(
  sourceRecordId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE source_records
    SET
      record_metadata = COALESCE(record_metadata, '{}'::jsonb)
        || jsonb_build_object('waitingOutcomeScanAt', ${new Date().toISOString()}),
      updated_at = now()
    WHERE id = ${sourceRecordId}
  `);
}

function replyContextFromRecord(
  row: typeof sourceRecords.$inferSelect,
): ReplyContext {
  const meta = (row.recordMetadata ?? {}) as Record<string, unknown>;
  const text = row.recordText ?? "";
  const senderEmail =
    (typeof meta.senderEmail === "string" ? meta.senderEmail : null) ??
    text.match(/sender_email:\s*(\S+)/i)?.[1]?.trim() ??
    null;
  return {
    threadId: typeof meta.threadId === "string" && meta.threadId ? meta.threadId : null,
    senderEmail: senderEmail ? senderEmail.toLowerCase() : null,
    subject: row.recordTitle ?? "",
  };
}

async function listActiveWaitingRows(userId: string): Promise<WaitingItem[]> {
  return getDb()
    .select()
    .from(waitingItems)
    .where(
      and(eq(waitingItems.userId, userId), inArray(waitingItems.status, ["open", "snoozed"])),
    )
    .limit(200);
}

/** Apply a classified outcome to a commitment: state change + evidence + audit. */
export async function applyWaitingOutcome(
  userId: string,
  item: WaitingItem,
  reply: typeof sourceRecords.$inferSelect,
  classification: {
    outcome: WaitingReplyOutcome;
    revisedExpectedAt: string | null;
    reason: string;
    confidence: number;
  },
): Promise<OutcomeApplication> {
  const application = decideOutcomeApplication(
    classification.outcome,
    classification.confidence,
  );
  const now = new Date();
  const metadata = { ...(item.metadata ?? {}) };
  const set: Partial<typeof waitingItems.$inferInsert> = {
    lastOutcome: classification.outcome,
    lastReplySourceRecordId: reply.id,
    updatedAt: now,
  };

  if (application === "complete") {
    set.status = "completed";
    set.completedAt = now;
    delete metadata.needsReview;
    delete metadata.suggestedResolution;
  } else if (application === "suggest_resolve") {
    // Trust-but-verify: the reply likely resolves the commitment, but closing
    // it is consequential — leave it open and ask the user to confirm.
    metadata.needsReview = true;
    metadata.suggestedResolution = {
      outcome: "completed",
      reason: classification.reason.slice(0, 300),
      replySourceRecordId: reply.id,
      confidence: classification.confidence,
      at: now.toISOString(),
    };
  } else if (application === "revise") {
    const revised = computeRevisedDates({
      revisedExpectedAt: classification.revisedExpectedAt,
      currentExpectedAt: item.expectedAt,
      promisedAt: item.promisedAt,
      dateConfidence: item.dateConfidence as DateConfidence,
      now,
    });
    set.expectedAt = revised.expectedAt;
    set.dateConfidence = revised.dateConfidence;
    set.followUpAt = revised.followUpAt;
    delete metadata.needsReview;
    delete metadata.suggestedResolution;
    metadata.revisedReason = classification.reason.slice(0, 300);
  } else if (application === "note") {
    metadata.lastStillWaitingAt = now.toISOString();
    delete metadata.needsReview;
    delete metadata.suggestedResolution;
  } else {
    metadata.needsReview = true;
    metadata.needsReviewReason = classification.reason.slice(0, 300) || "Reply needs review";
    delete metadata.suggestedResolution;
  }
  set.metadata = metadata;

  await getDb().update(waitingItems).set(set).where(eq(waitingItems.id, item.id));

  await createEvidenceForUser(userId, {
    entityType: "waiting_item",
    entityId: item.id,
    claimType: `waiting_outcome_${classification.outcome}`,
    sourceRecordId: reply.id,
    evidenceText: classification.reason || (reply.recordText ?? "").slice(0, 400),
  });
  await writeAuditLog({
    userId,
    action: OUTCOME_AUDIT_ACTION[classification.outcome],
    entityType: "waiting_item",
    entityId: item.id,
    metadata: {
      outcome: classification.outcome,
      application,
      reason: classification.reason.slice(0, 300),
      confidence: classification.confidence,
      replySourceRecordId: reply.id,
      revisedExpectedAt: classification.revisedExpectedAt,
    },
  });
  return application;
}

/**
 * Post-sync pass: match new inbound replies to open commitments and
 * auto-classify the outcome. Runs in the same job as extraction.
 */
export async function processWaitingOutcomesForUser(
  userId: string,
  opts?: { limit?: number },
): Promise<{ scanned: number; matched: number; applied: number }> {
  const limit = opts?.limit ?? 15;
  const replies = await listUnprocessedInboundReplies(userId, limit);
  if (replies.length === 0) return { scanned: 0, matched: 0, applied: 0 };

  const active = await listActiveWaitingRows(userId);
  let matched = 0;
  let applied = 0;

  for (const reply of replies) {
    try {
      const ctx = replyContextFromRecord(reply);
      const match =
        active.length > 0 ? matchWaitingItemForReply(active, ctx) : null;
      if (!match) {
        await markSourceScannedForWaitingOutcome(reply.id);
        continue;
      }
      matched += 1;

      const classification = await aiService.classifyWaitingReply({
        ownerName: match.item.ownerName,
        deliverable: match.item.deliverable,
        expectedAt: match.item.expectedAt?.toISOString().slice(0, 10) ?? null,
        replySubject: reply.recordTitle ?? "",
        replyBody: reply.recordText ?? "",
      });
      logger.info(
        {
          userId,
          waitingItemId: match.item.id,
          replySourceRecordId: reply.id,
          matchType: match.matchType,
          outcome: classification.outcome,
          promptVersion: CLASSIFY_WAITING_REPLY_PROMPT_VERSION,
        },
        "Waiting reply classified",
      );

      await applyWaitingOutcome(userId, match.item, reply, {
        outcome: classification.outcome,
        revisedExpectedAt: classification.revisedExpectedAt,
        reason: classification.reason,
        confidence: classification.confidence,
      });
      applied += 1;
      await markSourceScannedForWaitingOutcome(reply.id);
    } catch (err) {
      logger.warn({ err, replySourceRecordId: reply.id }, "Waiting outcome processing failed");
      try {
        await markSourceScannedForWaitingOutcome(reply.id);
      } catch {
        /* ignore */
      }
    }
  }

  return { scanned: replies.length, matched, applied };
}
