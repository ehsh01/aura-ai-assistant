import { aiService } from "./ai";
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
import { EXTRACT_DEADLINE_PROMPT_VERSION } from "../prompts/extractDeadline.v1";
import { resolvePersonByName } from "./people";
import { listProjectsForUser } from "./projects";

const AUTO_CREATE_CONFIDENCE = 0.75;

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

      if (
        !item.hasCommitment ||
        !item.dueAt ||
        item.confidence < AUTO_CREATE_CONFIDENCE
      ) {
        continue;
      }

      const dueAt = dueAtFromDateString(item.dueAt);
      if (!dueAt) continue;
      if (dueAt.getTime() < Date.now() - 12 * 3_600_000) continue;

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
