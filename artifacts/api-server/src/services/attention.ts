import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { attentionItems, auditLog, type AttentionItem } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { newAttentionId } from "../lib/recall-format";
import { upsertEntityLink } from "./entity-links";
import { writeAuditLog } from "./audit";

export type AttentionKind = "deadline" | "appointment" | "follow_up" | "other";
export type AttentionStatus = "open" | "seen" | "snoozed" | "dismissed" | "completed";
export type DateConfidence = "certain" | "uncertain";

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
  taskId: string | null;
  organizationId: string | null;
  waitingItemId: string | null;
  dateConfidence: DateConfidence;
  timeZone: string | null;
  timeKnown: boolean;
  confirmedAt: string | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
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
  taskId?: string | null;
  organizationId?: string | null;
  waitingItemId?: string | null;
  dateConfidence?: DateConfidence | null;
  timeZone?: string | null;
  timeKnown?: boolean | null;
  /** Explicit override; default auto-confirms certain dates only. */
  confirmed?: boolean;
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

function normalizeDateConfidence(value?: string | null): DateConfidence {
  return value === "uncertain" ? "uncertain" : "certain";
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
    taskId: row.taskId ?? null,
    organizationId: row.organizationId ?? null,
    waitingItemId: row.waitingItemId ?? null,
    dateConfidence: normalizeDateConfidence(row.dateConfidence),
    timeZone: row.timeZone ?? null,
    timeKnown: row.timeKnown === true,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confidence: row.confidence ?? null,
    metadata: row.metadata ?? {},
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
        dateConfidence: input.dateConfidence
          ? normalizeDateConfidence(input.dateConfidence)
          : prev.dateConfidence,
        timeZone: input.timeZone !== undefined ? input.timeZone : prev.timeZone,
        timeKnown: input.timeKnown ?? prev.timeKnown,
        confidence: input.confidence ?? prev.confidence,
        metadata: input.metadata ?? prev.metadata,
        // confirmedAt is preserved: the dedupe key includes dueAt, so the
        // source date can never change for an existing row.
        updatedAt: now,
      })
      .where(eq(attentionItems.id, prev.id))
      .returning();
    return toDto(row!);
  }

  const dateConfidence = normalizeDateConfidence(input.dateConfidence);
  const confirmed = input.confirmed ?? dateConfidence === "certain";
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
      taskId: input.taskId ?? null,
      organizationId: input.organizationId ?? null,
      waitingItemId: input.waitingItemId ?? null,
      dateConfidence,
      timeZone: input.timeZone ?? null,
      timeKnown: input.timeKnown === true,
      confirmedAt: confirmed ? now : null,
      confidence: input.confidence ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const dto = toDto(row!);
  const SOURCE_LINK_TYPES = new Set(["source_record", "note", "capture_item", "capture"]);
  if (SOURCE_LINK_TYPES.has(input.sourceEntityType)) {
    await upsertEntityLink(userId, {
      fromEntityType: "attention_item",
      fromEntityId: dto.id,
      toEntityType: input.sourceEntityType,
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
  await writeAuditLog({
    userId,
    action: "attention_created",
    entityType: "attention_item",
    entityId: dto.id,
    metadata: {
      title: dto.title.slice(0, 200),
      dueAt: dto.dueAt,
      kind: dto.kind,
      dateConfidence,
      confirmed,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
    },
  });
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
  if (!row) return null;
  await writeAuditLog({
    userId,
    action: "attention_dismissed",
    entityType: "attention_item",
    entityId: row.id,
    metadata: { title: row.title.slice(0, 200), dueAt: row.dueAt.toISOString() },
  });
  return toDto(row);
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
  if (!row) return null;
  await writeAuditLog({
    userId,
    action: "attention_completed",
    entityType: "attention_item",
    entityId: row.id,
    metadata: { title: row.title.slice(0, 200), dueAt: row.dueAt.toISOString() },
  });
  return toDto(row);
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
  if (!row) return null;
  await writeAuditLog({
    userId,
    action: "attention_snoozed",
    entityType: "attention_item",
    entityId: row.id,
    metadata: {
      title: row.title.slice(0, 200),
      snoozedUntil: until.toISOString(),
      preset: input.preset ?? null,
    },
  });
  return toDto(row);
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

// --- Deadline intelligence: reasons, confirmation, correction, grouping ------

export type AttentionDueReason = {
  label: string;
  overdue: boolean;
  highRisk: boolean;
  unconfirmed: boolean;
};

/** Plain-language due reason for Today / deadlines views (pure — unit tested). */
export function attentionDueReason(
  item: { dueAt: string; dateConfidence?: string | null; confirmedAt?: string | null },
  now: Date = new Date(),
): AttentionDueReason {
  const due = Date.parse(item.dueAt);
  const unconfirmed = item.confirmedAt == null && item.dateConfidence === "uncertain";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDueDay = new Date(due);
  startOfDueDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfDueDay.getTime() - startOfToday.getTime()) / 86_400_000,
  );
  const overdue = due < now.getTime();
  let label: string;
  if (dayDiff < 0) label = `${-dayDiff} day${dayDiff === -1 ? "" : "s"} overdue`;
  else if (dayDiff === 0) label = overdue ? "Due earlier today" : "Due today";
  else if (dayDiff === 1) label = "Due tomorrow";
  else if (dayDiff <= 7) label = `Due in ${dayDiff} days`;
  else {
    label = `Due ${new Date(due).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;
  }
  if (unconfirmed) label += " · confirm date";
  const hours = (due - now.getTime()) / 3_600_000;
  const highRisk = overdue || (hours <= 48 && unconfirmed);
  return { label, overdue, highRisk, unconfirmed };
}

export type AttentionPatch = {
  title?: string | null;
  summary?: string | null;
  dueAt?: string | null;
  timeZone?: string | null;
  timeKnown?: boolean | null;
  dateConfidence?: string | null;
  kind?: string | null;
  personId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  organizationId?: string | null;
  waitingItemId?: string | null;
};

/** Validate a user patch without touching the DB (pure — unit tested). */
export function validateAttentionPatch(patch: AttentionPatch): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (patch.title !== undefined && patch.title !== null) {
    if (!patch.title.trim()) errors.push("title must not be empty");
    else if (patch.title.length > 500) errors.push("title must be at most 500 characters");
  }
  if (patch.dueAt !== undefined && patch.dueAt !== null && !dueAtFromDateString(patch.dueAt)) {
    errors.push("dueAt must be a valid date or datetime");
  }
  if (patch.kind !== undefined && patch.kind !== null && !KINDS.has(patch.kind as AttentionKind)) {
    errors.push(`kind must be one of ${[...KINDS].join(", ")}`);
  }
  if (
    patch.dateConfidence !== undefined &&
    patch.dateConfidence !== null &&
    patch.dateConfidence !== "certain" &&
    patch.dateConfidence !== "uncertain"
  ) {
    errors.push("dateConfidence must be certain or uncertain");
  }
  if (patch.timeZone !== undefined && patch.timeZone !== null && patch.timeZone.length > 64) {
    errors.push("timeZone must be at most 64 characters");
  }
  return { ok: errors.length === 0, errors };
}

/** User correction of any extracted field. Editing the date confirms it. */
export async function patchAttentionItemForUser(
  userId: string,
  id: string,
  patch: AttentionPatch,
): Promise<AttentionItemDto | null> {
  const rows = await getDb()
    .select()
    .from(attentionItems)
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .limit(1);
  const prev = rows[0];
  if (!prev) return null;

  const now = new Date();
  const changed: string[] = [];
  const set: Partial<typeof attentionItems.$inferInsert> = { updatedAt: now };

  if (patch.title !== undefined && patch.title !== null && patch.title.trim() !== prev.title) {
    set.title = patch.title.trim().slice(0, 500);
    changed.push("title");
  }
  if (patch.summary !== undefined) {
    set.summary = patch.summary;
    changed.push("summary");
  }
  if (patch.dueAt !== undefined && patch.dueAt !== null) {
    const parsed = dueAtFromDateString(patch.dueAt);
    if (parsed && parsed.getTime() !== prev.dueAt.getTime()) {
      set.dueAt = parsed;
      // A user-corrected date counts as confirmed and certain.
      set.confirmedAt = now;
      set.dateConfidence = normalizeDateConfidence(patch.dateConfidence ?? "certain");
      changed.push("dueAt");
    }
  }
  if (patch.dateConfidence !== undefined && patch.dateConfidence !== null && !set.dateConfidence) {
    set.dateConfidence = normalizeDateConfidence(patch.dateConfidence);
    changed.push("dateConfidence");
  }
  if (patch.timeZone !== undefined) {
    set.timeZone = patch.timeZone;
    changed.push("timeZone");
  }
  if (patch.timeKnown !== undefined && patch.timeKnown !== null) {
    set.timeKnown = patch.timeKnown;
    changed.push("timeKnown");
  }
  if (patch.kind !== undefined && patch.kind !== null) {
    set.kind = normalizeKind(patch.kind);
    changed.push("kind");
  }
  for (const key of ["personId", "projectId", "taskId", "organizationId", "waitingItemId"] as const) {
    if (patch[key] !== undefined) {
      (set as Record<string, unknown>)[key] = patch[key] || null;
      changed.push(key);
    }
  }

  if (!changed.length) return toDto(prev);

  const [row] = await getDb()
    .update(attentionItems)
    .set(set)
    .where(eq(attentionItems.id, prev.id))
    .returning();
  if (!row) return null;

  if (patch.personId) {
    await upsertEntityLink(userId, {
      fromEntityType: "attention_item",
      fromEntityId: row.id,
      toEntityType: "person",
      toEntityId: patch.personId,
      linkType: "primary_person",
    });
  }

  await writeAuditLog({
    userId,
    action: "attention_updated",
    entityType: "attention_item",
    entityId: row.id,
    metadata: { changed, title: row.title.slice(0, 200) },
  });
  return toDto(row);
}

/** Confirm an extracted date (upgrades it to certain). */
export async function confirmAttentionItemForUser(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({ confirmedAt: now, dateConfidence: "certain", updatedAt: now })
    .where(and(eq(attentionItems.id, id), eq(attentionItems.userId, userId)))
    .returning();
  if (!row) return null;
  await writeAuditLog({
    userId,
    action: "attention_confirmed",
    entityType: "attention_item",
    entityId: row.id,
    metadata: { title: row.title.slice(0, 200), dueAt: row.dueAt.toISOString() },
  });
  return toDto(row);
}

/** Reopen a dismissed/completed/snoozed item without losing history. */
export async function reopenAttentionItemForUser(
  userId: string,
  id: string,
): Promise<AttentionItemDto | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(attentionItems)
    .set({
      status: "open",
      dismissedAt: null,
      completedAt: null,
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(attentionItems.id, id),
        eq(attentionItems.userId, userId),
        inArray(attentionItems.status, ["dismissed", "completed", "snoozed"]),
      ),
    )
    .returning();
  if (!row) return null;
  await writeAuditLog({
    userId,
    action: "attention_reopened",
    entityType: "attention_item",
    entityId: row.id,
    metadata: { title: row.title.slice(0, 200) },
  });
  return toDto(row);
}

export type DeadlineGroups = {
  overdue: AttentionItemDto[];
  today: AttentionItemDto[];
  thisWeek: AttentionItemDto[];
  later: AttentionItemDto[];
  unconfirmed: AttentionItemDto[];
  snoozed: AttentionItemDto[];
};

/** Group active items for the deadlines view (pure — unit tested). */
export function groupDeadlines(
  items: AttentionItemDto[],
  now: Date = new Date(),
): DeadlineGroups {
  const groups: DeadlineGroups = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    unconfirmed: [],
    snoozed: [],
  };
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = startOfToday.getTime() + 86_400_000;
  const endOfWeek = startOfToday.getTime() + 7 * 86_400_000;

  for (const item of items) {
    if (item.status === "snoozed") {
      groups.snoozed.push(item);
      continue;
    }
    if (item.confirmedAt == null && item.dateConfidence === "uncertain") {
      groups.unconfirmed.push(item);
      continue;
    }
    const due = Date.parse(item.dueAt);
    if (due < startOfToday.getTime()) groups.overdue.push(item);
    else if (due < startOfTomorrow) groups.today.push(item);
    else if (due < endOfWeek) groups.thisWeek.push(item);
    else groups.later.push(item);
  }
  return groups;
}

export type DeadlinesOverview = DeadlineGroups & {
  recentTerminal: AttentionItemDto[];
};

/** Everything the /deadlines view needs in one call. */
export async function listDeadlinesForUser(userId: string): Promise<DeadlinesOverview> {
  const now = new Date();
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

  const active = await getDb()
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.userId, userId),
        inArray(attentionItems.status, ["open", "seen", "snoozed"]),
      ),
    )
    .orderBy(asc(attentionItems.dueAt))
    .limit(200);
  const terminal = await getDb()
    .select()
    .from(attentionItems)
    .where(
      and(
        eq(attentionItems.userId, userId),
        inArray(attentionItems.status, ["dismissed", "completed"]),
      ),
    )
    .orderBy(desc(attentionItems.updatedAt))
    .limit(10);

  return {
    ...groupDeadlines(active.map(toDto), now),
    recentTerminal: terminal.map(toDto),
  };
}

/** Audit timeline for the detail view (newest first). */
export async function listAttentionAuditForItem(
  userId: string,
  id: string,
  limit = 50,
): Promise<
  { id: string; action: string; metadata: Record<string, unknown>; createdAt: string }[]
> {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.entityType, "attention_item"),
        eq(auditLog.entityId, id),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  }));
}
