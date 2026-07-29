/**
 * Person context (Phase 5): one grounded aggregation for "everything about
 * this person" — messages, tasks, deadlines, waiting items, notes, a
 * next-best-action, and a compact timeline. All deterministic: the summary is
 * built from counts and dates only, and the next action is only returned when
 * a high-confidence actionable item exists.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { notes as notesTable, sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import {
  getPersonForUser,
  getPersonRelatedForUser,
  type PersonDto,
} from "./people";
import { listTasksForUser, type RecallTaskDto } from "./tasks";
import {
  isWaitingDueForBriefing,
  sourceLabelFor,
  type BriefingAction,
} from "./briefing";
import { listWaitingItemsForUser, type WaitingItemDto } from "./waiting-items";
import { attentionDueReason, listDeadlinesForUser, type AttentionItemDto } from "./attention";
import { listProjectsForUser } from "./projects";
import { listPersonNameAliases } from "./user-corrections";
import { matchPersonId } from "./waiting-on";
import { computeLinkSuggestions, type LinkSuggestion } from "./link-suggestions";
import { todayIso } from "./query-utils";

export interface PersonContextMessage {
  id: string;
  title: string;
  from: string | null;
  at: string;
  sourceUrl: string | null;
}

export interface PersonContextItem {
  kind: "waiting" | "deadline" | "task" | "note";
  id: string;
  title: string;
  detail: string | null;
  at: string | null;
  href: string;
}

export interface PersonContextTimelineItem {
  at: string;
  kind: "message" | "note" | "task" | "waiting" | "deadline";
  title: string;
  subtitle: string | null;
  href: string;
}

export interface PersonContextStats {
  openTasks: number;
  waitingOpen: number;
  deadlinesOpen: number;
  notes: number;
  lastMessageAt: string | null;
}

export interface PersonContextDto {
  person: PersonDto;
  summary: string;
  stats: PersonContextStats;
  nextBestAction: BriefingAction | null;
  /** What this person owes the user (open/snoozed waiting items). */
  theyOweYou: PersonContextItem[];
  /** What the user owes this person (open tasks requested by them). */
  youOweThem: PersonContextItem[];
  deadlines: PersonContextItem[];
  recentMessages: PersonContextMessage[];
  notes: { id: string; title: string; preview: string | null; href: string }[];
  timeline: PersonContextTimelineItem[];
  linkSuggestions: LinkSuggestion[];
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

export function buildPersonSummary(stats: PersonContextStats, personName: string): string {
  const parts: string[] = [];
  if (stats.waitingOpen) {
    parts.push(`${stats.waitingOpen} open follow-up${stats.waitingOpen === 1 ? "" : "s"} from ${personName}`);
  }
  if (stats.openTasks) {
    parts.push(`${stats.openTasks} task${stats.openTasks === 1 ? "" : "s"} you owe them`);
  }
  if (stats.deadlinesOpen) {
    parts.push(`${stats.deadlinesOpen} linked deadline${stats.deadlinesOpen === 1 ? "" : "s"}`);
  }
  if (stats.lastMessageAt) {
    parts.push(`last email ${stats.lastMessageAt.slice(0, 10)}`);
  }
  if (parts.length === 0) {
    return `No activity with ${personName} yet — emails, tasks, and deadlines linked to them will appear here.`;
  }
  return parts.length > 2
    ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}.`
    : `${parts.join(" and ")}.`;
}

/**
 * Next best action for a person — only when something is both actionable and
 * high-confidence: a due waiting item (extraction confidence ≥ 0.7), a
 * confirmed overdue deadline, or a high-priority due task. Otherwise null.
 */
export function pickPersonNextAction(input: {
  waiting: WaitingItemDto[];
  attention: AttentionItemDto[];
  tasks: RecallTaskDto[];
  today: string;
  now: Date;
}): BriefingAction | null {
  const dueWaiting = input.waiting
    .filter((w) => isWaitingDueForBriefing(w, input.today) && w.confidence >= 0.7)
    .sort((a, b) => (a.expectedAt ?? a.followUpAt ?? "").localeCompare(b.expectedAt ?? b.followUpAt ?? ""));
  if (dueWaiting.length > 0) {
    const w = dueWaiting[0]!;
    const promised = w.promisedAt?.slice(0, 10) ?? null;
    const days = promised ? Math.max(0, Math.round((Date.parse(input.today) - Date.parse(promised)) / 86_400_000)) : null;
    return {
      kind: "waiting",
      id: w.id,
      title: w.deliverable,
      reason: days != null && days >= 2 ? `You asked ${w.ownerName} ${days} days ago — time to follow up` : `Follow-up with ${w.ownerName} is due`,
      href: w.href,
      sourceLabel: sourceLabelFor(w.sourceEntityType),
    };
  }

  const overdueDeadline = input.attention
    .filter((a) => a.confirmedAt != null && attentionDueReason(a, input.now).overdue)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  if (overdueDeadline.length > 0) {
    const a = overdueDeadline[0]!;
    return {
      kind: a.kind === "appointment" ? "appointment" : "deadline",
      id: a.id,
      title: a.title,
      reason: attentionDueReason(a, input.now).label,
      href: a.href,
      sourceLabel: sourceLabelFor(a.sourceEntityType),
    };
  }

  const hotTask = input.tasks
    .filter((t) => !t.completed && t.priority === "high" && Boolean(t.time) && t.time!.slice(0, 10) <= input.today)
    .sort((a, b) => a.time!.localeCompare(b.time!));
  if (hotTask.length > 0) {
    const t = hotTask[0]!;
    return {
      kind: "task",
      id: t.id,
      title: t.title,
      reason: "High priority — due",
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
      sourceLabel: "Tasks",
    };
  }

  return null;
}

/** Compact merged timeline, newest first, capped. */
export function buildPersonTimeline(input: {
  messages: PersonContextMessage[];
  notes: { id: string; title: string; updatedAt?: string | null }[];
  tasks: RecallTaskDto[];
  waiting: WaitingItemDto[];
  attention: AttentionItemDto[];
  limit?: number;
}): PersonContextTimelineItem[] {
  const items: PersonContextTimelineItem[] = [];
  for (const m of input.messages) {
    items.push({ at: m.at, kind: "message", title: m.title, subtitle: m.from, href: m.sourceUrl ?? "#" });
  }
  for (const n of input.notes) {
    if (!n.updatedAt) continue;
    items.push({ at: n.updatedAt, kind: "note", title: n.title, subtitle: "Note", href: `/notes?note=${encodeURIComponent(n.id)}` });
  }
  for (const t of input.tasks) {
    items.push({
      at: t.updatedAt,
      kind: "task",
      title: t.title,
      subtitle: t.completed ? "Task completed (approx.)" : "Task updated",
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
    });
  }
  for (const w of input.waiting) {
    const at = w.completedAt ?? w.updatedAt;
    items.push({
      at,
      kind: "waiting",
      title: w.deliverable,
      subtitle: w.status === "completed" ? "Follow-up resolved" : `Follow-up ${w.status}`,
      href: w.href,
    });
  }
  for (const a of input.attention) {
    const at = a.completedAt ?? a.dueAt;
    items.push({
      at,
      kind: "deadline",
      title: a.title,
      subtitle: a.status === "completed" ? "Deadline completed" : "Deadline",
      href: a.href,
    });
  }
  return items
    .filter((i) => Boolean(i.at))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? 12);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Recent Gmail messages involving this person. Matches strictly on the
 * resolved person's own email (or full name when no email is known) — never
 * another person's — and is always scoped to the requesting user.
 */
export async function listRecentMessagesForPerson(
  userId: string,
  person: { email: string | null; displayName: string },
  limit = 6,
): Promise<PersonContextMessage[]> {
  const conditions = [eq(sourceRecords.userId, userId), eq(sourceRecords.recordType, "gmail_message")];
  if (person.email) {
    conditions.push(
      or(
        ilike(sql`${sourceRecords.recordMetadata} ->> 'senderEmail'`, person.email),
        ilike(sourceRecords.recordText, `%${person.email}%`),
      )!,
    );
  } else {
    conditions.push(ilike(sourceRecords.recordText, `%${person.displayName}%`));
  }

  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      title: sourceRecords.recordTitle,
      text: sourceRecords.recordText,
      metadata: sourceRecords.recordMetadata,
      sourceUrl: sourceRecords.sourceUrl,
      at: sourceRecords.sourceCreatedAt,
    })
    .from(sourceRecords)
    .where(and(...conditions))
    .orderBy(desc(sourceRecords.sourceCreatedAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const senderName = typeof meta.senderName === "string" ? meta.senderName : null;
    const senderEmail = typeof meta.senderEmail === "string" ? meta.senderEmail : null;
    return {
      id: row.id,
      title: row.title?.trim() || "(no subject)",
      from: senderName || senderEmail,
      at: (row.at ?? new Date(0)).toISOString(),
      sourceUrl: row.sourceUrl ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function getPersonContextForUser(
  userId: string,
  personId: string,
): Promise<PersonContextDto | null> {
  const person = await getPersonForUser(userId, personId);
  if (!person) return null;

  const now = new Date();
  const today = todayIso(now);
  const [related, allTasks, allWaiting, deadlines, messages, aliases, projects, datedNotes] =
    await Promise.all([
      getPersonRelatedForUser(userId, personId),
      listTasksForUser(userId),
      listWaitingItemsForUser(userId, { status: "all", limit: 100 }),
      listDeadlinesForUser(userId),
      listRecentMessagesForPerson(userId, person),
      listPersonNameAliases(userId),
      listProjectsForUser(userId),
      // Dated notes for the timeline (the related aggregate carries no dates).
      getDb()
        .select({ id: notesTable.id, title: notesTable.title, updatedAt: notesTable.updatedAt })
        .from(notesTable)
        .where(and(eq(notesTable.userId, userId), eq(notesTable.primaryPersonId, personId)))
        .orderBy(desc(notesTable.updatedAt))
        .limit(12),
    ]);

  const people = [{ id: person.id, displayName: person.displayName }];
  const isThisPerson = (name: string) => matchPersonId(name, people, aliases) === person.id;

  const personWaiting = allWaiting.filter(
    (w) => w.ownerPersonId === person.id || (!w.ownerPersonId && isThisPerson(w.ownerName)),
  );
  const activeWaiting = personWaiting.filter((w) => w.status === "open" || w.status === "snoozed");

  const personTasks = allTasks.filter((t) => t.requesterPersonId === person.id);
  const openTasks = personTasks.filter((t) => !t.completed);

  const attentionAll = [
    ...deadlines.overdue,
    ...deadlines.today,
    ...deadlines.thisWeek,
    ...deadlines.later,
    ...deadlines.unconfirmed,
    ...deadlines.snoozed,
  ];
  const personAttention = attentionAll.filter((a) => a.personId === person.id);
  const openAttention = personAttention.filter((a) => a.status === "open" || a.status === "seen");

  const personNotes = (related?.taggedNotes ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    preview: n.preview ?? null,
    href: `/notes?note=${encodeURIComponent(n.id)}`,
  }));

  const stats: PersonContextStats = {
    openTasks: openTasks.length,
    waitingOpen: activeWaiting.length,
    deadlinesOpen: openAttention.length,
    notes: personNotes.length,
    lastMessageAt: messages[0]?.at ?? null,
  };

  const linkSuggestions = computeLinkSuggestions({
    people: [person],
    aliases,
    projects,
    attention: attentionAll,
    waiting: allWaiting,
    tasks: allTasks,
    limit: 5,
  }).filter((s) => s.suggestedKind === "person" && s.suggestedId === person.id);

  return {
    person,
    summary: buildPersonSummary(stats, person.displayName),
    stats,
    nextBestAction: pickPersonNextAction({
      waiting: activeWaiting,
      attention: openAttention,
      tasks: openTasks,
      today,
      now,
    }),
    theyOweYou: activeWaiting.map((w) => ({
      kind: "waiting",
      id: w.id,
      title: w.deliverable,
      detail: isWaitingDueForBriefing(w, today) ? "Follow-up due" : `Next check ${w.followUpAt?.slice(0, 10) ?? "later"}`,
      at: w.promisedAt,
      href: w.href,
    })),
    youOweThem: openTasks.map((t) => ({
      kind: "task",
      id: t.id,
      title: t.title,
      detail: t.time ? `Due ${t.time.slice(0, 10)}` : t.priority === "high" ? "High priority" : null,
      at: t.createdAt,
      href: `/tasks?task=${encodeURIComponent(t.id)}`,
    })),
    deadlines: openAttention.map((a) => ({
      kind: "deadline",
      id: a.id,
      title: a.title,
      detail: attentionDueReason(a, now).label,
      at: a.dueAt,
      href: a.href,
    })),
    recentMessages: messages,
    notes: personNotes,
    timeline: buildPersonTimeline({
      messages,
      notes: datedNotes.map((n) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt.toISOString(),
      })),
      tasks: personTasks,
      waiting: personWaiting,
      attention: personAttention,
    }),
    linkSuggestions,
  };
}
