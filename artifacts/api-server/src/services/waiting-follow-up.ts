import { and, asc, eq } from "drizzle-orm";
import { sourceRecords, waitingItems } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { aiService } from "./ai";
import { writeAuditLog } from "./audit";
import {
  advanceWaitingFollowUp,
  getWaitingItemForUser,
  WAITING_DEFAULT_FOLLOWUP_DAYS,
  type WaitingItemDto,
} from "./waiting-items";

const MAX_THREAD_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 900;
const MAX_EXCERPT_CHARS = 4000;

/**
 * Build a quote-only excerpt from the original thread/source records. Only
 * facts actually present in the sources reach the draft prompt.
 */
export function buildThreadExcerpt(
  records: {
    recordTitle: string | null;
    recordText: string | null;
    sourceCreatedAt: Date | null;
  }[],
): string {
  const parts: string[] = [];
  let total = 0;
  for (const rec of records.slice(0, MAX_THREAD_MESSAGES)) {
    const date = rec.sourceCreatedAt
      ? rec.sourceCreatedAt.toISOString().slice(0, 10)
      : "unknown date";
    const from = rec.recordText?.match(/sender_name:\s*(.+)/i)?.[1]?.trim()
      || rec.recordText?.match(/^From:\s*(.+)$/im)?.[1]?.trim()
      || "unknown sender";
    const body = (rec.recordText ?? "")
      .replace(/\r/g, "")
      .replace(/\s+\n/g, "\n")
      .trim()
      .slice(0, MAX_MESSAGE_CHARS);
    if (!body) continue;
    const part = `--- ${date} · ${from} · ${rec.recordTitle ?? "(no subject)"} ---\n${body}`;
    if (total + part.length > MAX_EXCERPT_CHARS) break;
    parts.push(part);
    total += part.length;
  }
  return parts.join("\n\n");
}

async function loadThreadRecords(
  userId: string,
  item: { threadId: string | null; sourceEntityType: string; sourceEntityId: string },
): Promise<typeof sourceRecords.$inferSelect[]> {
  if (item.threadId) {
    const rows = await getDb()
      .select()
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.userId, userId),
          eq(sourceRecords.recordType, "gmail_message"),
        ),
      )
      .orderBy(asc(sourceRecords.sourceCreatedAt))
      .limit(40);
    const inThread = rows.filter((r) => {
      const meta = (r.recordMetadata ?? {}) as Record<string, unknown>;
      return meta.threadId === item.threadId;
    });
    if (inThread.length > 0) return inThread;
  }
  if (item.sourceEntityType === "source_record") {
    const rows = await getDb()
      .select()
      .from(sourceRecords)
      .where(
        and(eq(sourceRecords.id, item.sourceEntityId), eq(sourceRecords.userId, userId)),
      )
      .limit(1);
    return rows;
  }
  return [];
}

export type WaitingFollowUpDraft = {
  subject: string;
  body: string;
  degraded: boolean;
};

/** Draft a follow-up grounded strictly in the thread/source records. */
export async function draftWaitingFollowUpForItem(
  userId: string,
  id: string,
): Promise<{ item: WaitingItemDto; draft: WaitingFollowUpDraft } | null> {
  const item = await getWaitingItemForUser(userId, id);
  if (!item) return null;

  const threadRecords = await loadThreadRecords(userId, item);
  const threadExcerpt =
    buildThreadExcerpt(threadRecords) ||
    `Original promise: ${item.ownerName} owes "${item.deliverable}".`;

  const draft = await aiService.draftWaitingFollowUp({
    ownerName: item.ownerName,
    deliverable: item.deliverable,
    promisedAt: item.promisedAt?.slice(0, 10) ?? null,
    expectedAt: item.expectedAt?.slice(0, 10) ?? null,
    threadExcerpt,
  });

  const now = new Date();
  const metadata = {
    ...(item.metadata ?? {}),
    lastDraft: {
      subject: draft.subject,
      body: draft.body,
      at: now.toISOString(),
      degraded: draft.degraded,
    },
  };
  await getDb()
    .update(waitingItems)
    .set({ metadata, updatedAt: now })
    .where(eq(waitingItems.id, item.id));

  await writeAuditLog({
    userId,
    action: "waiting_follow_up_drafted",
    entityType: "waiting_item",
    entityId: item.id,
    metadata: { ownerName: item.ownerName, degraded: draft.degraded },
  });

  const refreshed = await getWaitingItemForUser(userId, id);
  return refreshed
    ? { item: refreshed, draft: { subject: draft.subject, body: draft.body, degraded: draft.degraded } }
    : null;
}

/** Mark the follow-up sent: record it and advance the next follow-up date. */
export async function markWaitingFollowUpSent(
  userId: string,
  id: string,
  opts?: { days?: number },
): Promise<WaitingItemDto | null> {
  const item = await getWaitingItemForUser(userId, id);
  if (!item) return null;

  const days = Math.min(Math.max(opts?.days ?? WAITING_DEFAULT_FOLLOWUP_DAYS, 1), 30);
  const now = new Date();
  const metadata = { ...(item.metadata ?? {}) };
  const sent = Array.isArray(metadata.sentFollowUps) ? metadata.sentFollowUps : [];
  sent.push({ at: now.toISOString(), days });
  metadata.sentFollowUps = sent.slice(-20);
  delete metadata.needsReview;

  await getDb()
    .update(waitingItems)
    .set({ metadata, updatedAt: now })
    .where(eq(waitingItems.id, item.id));

  await writeAuditLog({
    userId,
    action: "waiting_follow_up_sent",
    entityType: "waiting_item",
    entityId: item.id,
    metadata: { ownerName: item.ownerName, nextFollowUpInDays: days },
  });

  return advanceWaitingFollowUp(userId, id, { days });
}
