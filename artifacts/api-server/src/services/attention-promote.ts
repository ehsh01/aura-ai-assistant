import { and, desc, eq, sql } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import {
  dueAtFromDateString,
  upsertAttentionItemForUser,
  type AttentionItemDto,
} from "./attention";
import { listProjectsForUser } from "./projects";

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
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

/**
 * Promote future Google calendar_event source_records into attention items (no LLM).
 */
export async function promoteCalendarEventsToAttention(
  userId: string,
  opts?: { limit?: number },
): Promise<{ createdOrUpdated: number; items: AttentionItemDto[] }> {
  const limit = opts?.limit ?? 80;
  const now = new Date();
  const rows = await getDb()
    .select()
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "calendar_event"),
      ),
    )
    .orderBy(desc(sourceRecords.sourceCreatedAt))
    .limit(limit);

  const projects = await listProjectsForUser(userId);
  const items: AttentionItemDto[] = [];
  let createdOrUpdated = 0;

  for (const row of rows) {
    const meta = (row.recordMetadata ?? {}) as Record<string, unknown>;
    const startRaw =
      metaString(meta, "start") ||
      (row.sourceCreatedAt ? row.sourceCreatedAt.toISOString() : null);
    if (!startRaw) continue;
    const dueAt = dueAtFromDateString(startRaw);
    if (!dueAt || dueAt.getTime() < now.getTime() - 2 * 3_600_000) continue;

    const title = (row.recordTitle ?? "Calendar event").trim().slice(0, 500);
    const location = metaString(meta, "location");
    const evidence =
      [startRaw ? `Start: ${startRaw}` : null, location ? `Location: ${location}` : null]
        .filter(Boolean)
        .join(" · ") || null;
    // Google dateTime starts carry a clock ("2026-07-28T14:00:00-04:00");
    // all-day starts are date-only ("2026-07-28").
    const timeKnown = /T\d{2}:\d{2}/.test(startRaw);

    try {
      const item = await upsertAttentionItemForUser(userId, {
        title,
        summary: location ? `At ${location}` : null,
        dueAt,
        kind: "appointment",
        sourceEntityType: "source_record",
        sourceEntityId: row.id,
        evidenceText: evidence,
        projectId: suggestProjectId(title, projects),
        confidence: 1,
        timeKnown,
        metadata: {
          promotedFrom: "calendar_event",
          externalId: row.externalId,
          sourceUrl: row.sourceUrl ?? null,
          location: location || null,
        },
      });
      items.push(item);
      createdOrUpdated += 1;
    } catch (err) {
      logger.warn(
        { err, sourceRecordId: row.id },
        "Failed to promote calendar event to attention",
      );
    }
  }

  return { createdOrUpdated, items };
}

/** Mark a source_record as scanned for deadline extraction (metadata flag). */
export async function markSourceScannedForDeadlines(
  sourceRecordId: string,
): Promise<void> {
  await getDb().execute(sql`
    UPDATE source_records
    SET
      record_metadata = COALESCE(record_metadata, '{}'::jsonb)
        || jsonb_build_object('deadlineScanAt', ${new Date().toISOString()}),
      updated_at = now()
    WHERE id = ${sourceRecordId}
  `);
}

export function isDeadlineScanned(meta: Record<string, unknown>): boolean {
  return typeof meta.deadlineScanAt === "string" && Boolean(meta.deadlineScanAt);
}

export async function listUnscannedGmailForDeadlines(
  userId: string,
  limit = 25,
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
    .limit(Math.min(limit * 4, 120));

  return rows
    .filter((r) => !isDeadlineScanned((r.recordMetadata ?? {}) as Record<string, unknown>))
    .slice(0, limit);
}
