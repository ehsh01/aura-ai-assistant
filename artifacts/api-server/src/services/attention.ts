import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { attentionItems, type AttentionItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAttentionId } from "../lib/recall-format";
import { upsertEntityLink } from "./entity-links";

export type AttentionKind = "deadline" | "appointment" | "follow_up" | "other";
export type AttentionStatus = "open" | "seen" | "snoozed" | "dismissed" | "completed";

export type AttentionItemDto = {
  id: string;
  title: string;
  summary: string | null;
  dueAt: string;
  kind: AttentionKind;
  status: AttentionStatus;
  seenAt: string | null;
  snoozedUntil: string | null;
  dismissedAt: string | null;
  completedAt: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  evidenceText: string | null;
  personId: string | null;
  projectId: string | null;
  confidence: number | null;
  href: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAttentionInput = {
  title: string;
  summary?: string | null;
  dueAt: Date;
  kind?: AttentionKind;
  sourceEntityType: string;
  sourceEntityId: string;
  evidenceText?: string | null;
  personId?: string | null;
  projectId?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
  /** When true, do not revive dismissed/completed items on re-sync. */
  respectTerminalStatus?: boolean;
};

const KINDS = new Set<AttentionKind>(["deadline", "appointment", "follow_up", "other"]);
const TERMINAL = new Set<AttentionStatus>(["dismissed", "completed"]);

function normalizeKind(kind?: string | null): AttentionKind {
  if (kind && KINDS.has(kind as AttentionKind)) return kind as AttentionKind;
  return "deadline";
}

function hrefFor(row: AttentionItem): string {
  if (row.sourceEntityType === "source_record") {
    return `/ask?q=${encodeURIComponent(row.title.slice(0, 80))}`;
  }
  return "/";
}

function toDto(row: AttentionItem): AttentionItemDto {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    dueAt: row.dueAt.toISOString(),
    kind: normalizeKind(row.kind),
    status: (row.status as AttentionStatus) || "open",
    seenAt: row.seenAt?.toISOString() ?? null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    evidenceText: row.evidenceText ?? null,
    personId: row.personId ?? null,
    projectId: row.projectId ?? null,
    confidence: row.confidence ?? null,
    href: hrefFor(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Parse YYYY-MM-DD or ISO into a Date at noon in recall TZ (best-effort). */
export function dueAtFromDateString(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Store as noon UTC-offset of local noon approximation.
    const d = new Date(`${s}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function upsertAttentionItemForUser(
  userId: string,
  input: UpsertAttentionInput,
): Promise<AttentionItemDto> {
  const now = new Date();
  const existing = await getDb()
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.userId, userId),
        eq(attentionItems.sourceEntityType, input.sourceEntityType),
        eq(attentionItems.sourceEntityId, input.sourceEntityId),
        eq(attentionItems.dueAt, input.dueAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const prev = existing[0];
    const terminal =
      (input.respectTerminalStatus !== false) &&
      TERMINAL.has(prev.status as AttentionStatus);
    if (terminal) return toDto(prev);

    const [row] = await getDb()
      .update(attentionItems)
      .set({
        title: input.title.trim().slice(0, 500) || prev.title,
        summary: input.summary ?? prev.summary,
        kind: normalizeKind(input.kind),
        evidenceText: input.evidenceText ?? prev.evidenceText,
        personId: input.personId ?? prev.personId,
        projectId: input.projectId ?? prev.projectId,
        confidence: input.confidence ?? prev.confidence,
        metadata: input.metadata ?? prev.metadata,
        // Wake snoozed items only when snooze window passed — leave status alone here.
        updatedAt: now,
      })
      .where(eq(attentionItems.id, prev.id))
      .returning();
    return toDto(row!);
  }

  const [row] = await getDb()
    .insert(attentionItems)
    .values({
      id: newAttentionId(),
      userId,
      title: input.title.trim().slice(0, 500) || "Reminder",
      summary: input.summary ?? null,
      dueAt: input.dueAt,
      kind: normalizeKind(input.kind),
      status: "open",
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      evidenceText: input.evidenceText ?? null,
      personId: input.personId ?? null,
      projectId: input.projectId ?? null,
      confidence: input.confidence ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const dto = toDto(row!);
  if (input.sourceEntityType === "source_record") {
    await upsertEntityLink(userId, {
      fromEntityType: "attention_item",
      fromEntityId: dto.id,
      toEntityType: "source_record",
      toEntityId: input.sourceEntityId,
      linkType: "derived_from",
    });
  }
  if (input.personId) {
    await upsertEntityLink(userId, {
      fromEntityType: "attention_item",
      fromEntityId: dto.id,
      toEntityType: "person",
      toEntityId: input.personId,
      linkType: "primary_person",
    });
  }
  return dto;
}

/**
 * Items that should appear on Today: open/seen, or snoozed whose snooze expired.
 */
export async function listAttentionForToday(
  userId: string,
  limit = 40,
): Promise<AttentionItemDto[]> {
  const now = new Date();

  // Wake expired snoozes.
  await getDb()
    .update(attentionItems)
    .set({ status: "open", snoozedUntil: null, updatedAt: now })
    .where(
      and(
        eq(attentionItems.userId, userId),
        eq(attentionItems.status, "snoozed"),
        lte(attentionItems.snoozedUntil, now),
      ),
    );

  const rows = await getDb()
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.userId, userId),
        inArray(attentionItems.status, ["open", "seen"]),
      ),
    )
    .orderBy(asc(attentionItems.dueAt))
    .limit(limit);

  return rows.map(toDto);
}

export async function getAttentionForUser(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const rows = await getDb()
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function markAttentionSeen(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({ status: "seen", seenAt: now, updatedAt: now })
    .where(
      and(
        eq(attentionItems.id, id),
        eq(attentionItems.userId, userId),
        inArray(attentionItems.status, ["open", "seen", "snoozed"]),
      ),
    )
    .returning();
  return row ? toDto(row) : null;
}

export async function dismissAttention(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({
      status: "dismissed",
      dismissedAt: now,
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .returning();
  return row ? toDto(row) : null;
}

export async function completeAttention(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({
      status: "completed",
      completedAt: now,
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .returning();
  return row ? toDto(row) : null;
}

export type SnoozePreset = "7d_before" | "1d_before" | "morning_of" | "1d" | "3d" | "7d";

export function resolveSnoozeUntil(
  dueAt: Date,
  preset: SnoozePreset,
  now: Date = new Date(),
): Date {
  const due = dueAt.getTime();
  if (preset === "7d_before") {
    return new Date(Math.max(now.getTime(), due - 7 * 86_400_000));
  }
  if (preset === "1d_before") {
    return new Date(Math.max(now.getTime(), due - 1 * 86_400_000));
  }
  if (preset === "morning_of") {
    // Morning of due date in local TZ approximation: due date 08:00 local-ish.
    const morning = new Date(dueAt);
    morning.setHours(8, 0, 0, 0);
    if (morning.getTime() <= now.getTime()) {
      return new Date(now.getTime() + 60 * 60_000);
    }
    return morning;
  }
  if (preset === "3d") return new Date(now.getTime() + 3 * 86_400_000);
  if (preset === "7d") return new Date(now.getTime() + 7 * 86_400_000);
  return new Date(now.getTime() + 1 * 86_400_000);
}

export async function snoozeAttention(
  userId: string,
  id: string,
  input: { until?: string | null; preset?: SnoozePreset | null },
): Promise<AttentionItemDto | null> {
  const rows = await getDb()
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .limit(1);
  const prev = rows[0];
  if (!prev) return null;
  if (TERMINAL.has(prev.status as AttentionStatus)) return toDto(prev);

  let until: Date | null = null;
  if (input.until) {
    until = new Date(input.until);
    if (Number.isNaN(until.getTime())) until = null;
  }
  if (!until && input.preset) {
    until = resolveSnoozeUntil(prev.dueAt, input.preset);
  }
  if (!until) {
    until = resolveSnoozeUntil(prev.dueAt, "1d_before");
  }

  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({
      status: "snoozed",
      snoozedUntil: until,
      updatedAt: now,
    })
    .where(eq(attentionItems.id, prev.id))
    .returning();
  return row ? toDto(row) : null;
}

/** Rank score for Today queue (higher = more urgent). */
export function attentionUrgencyScore(item: AttentionItemDto, now: Date = new Date()): number {
  const due = Date.parse(item.dueAt);
  const hours = (due - now.getTime()) / 3_600_000;
  let score = 0;
  if (hours < 0) score += 100 - Math.min(48, Math.abs(hours)); // overdue
  else if (hours <= 48) score += 80 - hours / 2;
  else if (hours <= 24 * 7) score += 40 - hours / 24;
  else score += 10;
  if (item.status === "open" && !item.seenAt) score += 8;
  if (item.kind === "deadline" || item.kind === "appointment") score += 4;
  return score;
}
