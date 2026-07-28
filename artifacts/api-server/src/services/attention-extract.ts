import { aiService, type ExtractDeadlineItem } from "./ai";
import { logger } from "../lib/logger";
import {
  dueAtFromDateString,
  upsertAttentionItemForUser,
  type AttentionItemDto,
} from "./attention";
import {
  listUnscannedGmailForDeadlines,
  markSourceScannedForDeadlines,
  promoteCalendarEventsToAttention,
} from "./attention-promote";
import { EXTRACT_DEADLINE_PROMPT_VERSION } from "../prompts/extractDeadline.v2";
import { resolvePersonByName } from "./people";
import { listProjectsForUser } from "./projects";

/** Explicit dates auto-create confirmed items at this confidence. */
export const CERTAIN_MIN_CONFIDENCE = 0.75;
/** Vague/inferred dates are kept as unconfirmed items at this confidence. */
export const UNCERTAIN_MIN_CONFIDENCE = 0.5;
/** Drop dates already past by more than this (stale threads, re-syncs). */
const PAST_GRACE_MS = 12 * 3_600_000;

/** Cues that a note contains a date worth an LLM extraction call. */
export const NOTE_DATE_CUE_RE =
  /\b(deadline|due|by (mond|tuesd|wednesd|thursd|frid|saturd|sund)ay|appointment|inspection|hearing|filing|remind|scheduled|expires?|renew|court|meeting|tomorrow|next week|end of (the )?month|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b)\b/i;

export function hasDateCues(text: string | null | undefined): boolean {
  return !!text && NOTE_DATE_CUE_RE.test(text);
}

export type MappedDeadline = {
  dueAt: Date;
  dateConfidence: "certain" | "uncertain";
  timeKnown: boolean;
  timeZone: string | null;
};

/**
 * Two-tier gate for an extracted deadline (pure — unit tested):
 * certain dates need CERTAIN_MIN_CONFIDENCE, uncertain dates are kept
 * (unconfirmed) at UNCERTAIN_MIN_CONFIDENCE. Never returns past dates.
 */
export function mapExtractedDeadline(
  item: ExtractDeadlineItem,
  now: Date = new Date(),
): MappedDeadline | null {
  if (!item.hasCommitment || !item.dueAt) return null;
  const dateConfidence = item.dateConfidence === "uncertain" ? "uncertain" : "certain";
  const min =
    dateConfidence === "certain" ? CERTAIN_MIN_CONFIDENCE : UNCERTAIN_MIN_CONFIDENCE;
  if (item.confidence < min) return null;
  const dueAt = dueAtFromDateString(item.dueAt);
  if (!dueAt) return null;
  if (dueAt.getTime() < now.getTime() - PAST_GRACE_MS) return null;
  return {
    dueAt,
    dateConfidence,
    timeKnown: item.timeKnown === true,
    timeZone: item.timeZone ?? null,
  };
}

/**
 * Map a capture classification's suggested due date onto an attention item
 * (pure — unit tested). Returns null when the date is unusable or stale.
 */
export function captureDueDatePromotion(
  input: { suggestedDueDate: string | null | undefined; confidence: number },
  now: Date = new Date(),
): { dueAt: Date; dateConfidence: "certain" | "uncertain" } | null {
  if (!input.suggestedDueDate) return null;
  const dueAt = dueAtFromDateString(input.suggestedDueDate);
  if (!dueAt) return null;
  if (dueAt.getTime() < now.getTime() - PAST_GRACE_MS) return null;
  return {
    dueAt,
    dateConfidence: input.confidence >= 0.8 ? "certain" : "uncertain",
  };
}

function suggestProjectId(
  title: string,
  projects: { id: string; name: string; status: string }[],
): string | null {
  const hay = title.toLowerCase();
  for (const p of projects) {
    if (p.status !== "active") continue;
    const name = p.name.trim().toLowerCase();
    if (name.length >= 3 && hay.includes(name)) return p.id;
  }
  return null;
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

/**
 * Scan recent unscanned Gmail messages for high-confidence dated commitments.
 */
export async function extractGmailDeadlinesForUser(
  userId: string,
  opts?: { limit?: number },
): Promise<{ scanned: number; created: number; items: AttentionItemDto[] }> {
  const limit = opts?.limit ?? 20;
  const rows = await listUnscannedGmailForDeadlines(userId, limit);
  const projects = await listProjectsForUser(userId);
  const items: AttentionItemDto[] = [];
  let created = 0;

  for (const row of rows) {
    try {
      const extracted = await aiService.extractDeadline({
        subject: row.recordTitle ?? "(no subject)",
        body: row.recordText ?? "",
      });
      const item = extracted.item;

      await markSourceScannedForDeadlines(row.id);

      const mapped = mapExtractedDeadline(item);
      if (!mapped) continue;
      const dueAt = mapped.dueAt;

      const from = parseFromField(row.recordText);
      let personId: string | null = null;
      const personName = item.personName?.trim() || from.name.trim();
      if (personName) {
        try {
          const person = await resolvePersonByName(userId, personName);
          personId = person.id;
        } catch {
          personId = null;
        }
      }

      const title =
        (item.title ?? row.recordTitle ?? "Deadline").trim().slice(0, 500) || "Deadline";

      const attn = await upsertAttentionItemForUser(userId, {
        title,
        summary: item.evidenceText,
        dueAt,
        kind: item.kind ?? "deadline",
        sourceEntityType: "source_record",
        sourceEntityId: row.id,
        evidenceText: item.evidenceText,
        personId,
        projectId: suggestProjectId(title, projects),
        confidence: item.confidence,
        dateConfidence: mapped.dateConfidence,
        timeZone: mapped.timeZone,
        timeKnown: mapped.timeKnown,
        metadata: {
          extractedFrom: "gmail_message",
          promptVersion: EXTRACT_DEADLINE_PROMPT_VERSION,
          externalId: row.externalId,
          sourceUrl: row.sourceUrl ?? null,
          suggested: false,
          degraded: extracted.degraded,
        },
      });
      items.push(attn);
      created += 1;
    } catch (err) {
      logger.warn({ err, sourceRecordId: row.id }, "Gmail deadline extract failed for record");
      try {
        await markSourceScannedForDeadlines(row.id);
      } catch {
        /* ignore */
      }
    }
  }

  return { scanned: rows.length, created, items };
}

/** Calendar promote + Gmail extract in one job. */
export async function processAttentionScanJob(
  userId: string,
): Promise<{ calendar: number; gmailCreated: number; gmailScanned: number }> {
  const cal = await promoteCalendarEventsToAttention(userId);
  const mail = await extractGmailDeadlinesForUser(userId);
  return {
    calendar: cal.createdOrUpdated,
    gmailCreated: mail.created,
    gmailScanned: mail.scanned,
  };
}

/** Enqueue a deadline scan for a note whose content has date cues. */
export async function scheduleNoteDeadlineScan(
  userId: string,
  noteId: string,
  content: string,
): Promise<void> {
  if (!hasDateCues(content)) return;
  try {
    const { enqueueJob, JOB_TYPE_ATTENTION_SCAN } = await import("./job-queue");
    const { nudgeJobWorker } = await import("./job-worker");
    await enqueueJob({
      userId,
      type: JOB_TYPE_ATTENTION_SCAN,
      payload: { noteId },
      id: `attn-note-${noteId}-${Date.now()}`,
    });
    nudgeJobWorker();
  } catch (err) {
    logger.warn({ err, noteId }, "Failed to schedule note deadline scan");
  }
}

/** Extract deadlines from a single note (job entry point for { noteId } scans). */
export async function scanNoteForDeadlines(
  userId: string,
  noteId: string,
): Promise<{ scanned: number; created: number }> {
  const { getNoteForUser } = await import("./notes");
  const note = await getNoteForUser(userId, noteId);
  if (!note) return { scanned: 0, created: 0 };
  const text = `${note.title}\n${note.content}`;
  if (!hasDateCues(text)) return { scanned: 1, created: 0 };

  const extracted = await aiService.extractDeadline({
    subject: note.title || "Note",
    body: note.content,
  });
  const mapped = mapExtractedDeadline(extracted.item);
  if (!mapped) return { scanned: 1, created: 0 };

  let personId: string | null = null;
  const personName = extracted.item.personName?.trim();
  if (personName) {
    try {
      personId = (await resolvePersonByName(userId, personName)).id;
    } catch {
      personId = null;
    }
  }

  await upsertAttentionItemForUser(userId, {
    title:
      (extracted.item.title ?? note.title ?? "Deadline").trim().slice(0, 500) || "Deadline",
    summary: extracted.item.evidenceText,
    dueAt: mapped.dueAt,
    kind: extracted.item.kind ?? "deadline",
    sourceEntityType: "note",
    sourceEntityId: noteId,
    evidenceText: extracted.item.evidenceText ?? note.content.slice(0, 500),
    personId,
    confidence: extracted.item.confidence,
    dateConfidence: mapped.dateConfidence,
    timeZone: mapped.timeZone,
    timeKnown: mapped.timeKnown,
    metadata: {
      extractedFrom: "note",
      promptVersion: EXTRACT_DEADLINE_PROMPT_VERSION,
      degraded: extracted.degraded,
    },
  });
  return { scanned: 1, created: 1 };
}
