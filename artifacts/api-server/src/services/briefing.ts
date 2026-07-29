/**
 * Daily briefing builders (Phase 4).
 *
 * Everything here is pure and unit-tested: callers (home briefing, /checkin,
 * the SMS sweep, Ask handlers) fetch the rows and pass them in. The builders
 * never invent items — empty inputs produce empty outputs, and every action
 * carries a source-based reason.
 *
 * Note: task ranking mirrors scoreTaskUrgency in home-briefing.ts. It is
 * duplicated deliberately (with the same signals) because home-briefing
 * imports this module — importing it back would create a cycle.
 */
import {
  attentionDueReason,
  attentionUrgencyScore,
  type AttentionItemDto,
} from "./attention";
import type { RecallTaskDto } from "./tasks";
import type { RecallCaptureItemDto } from "./capture-items";
import type { WaitingItemDto } from "./waiting-items";
import { recallTimezone } from "./query-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefingActionKind = "deadline" | "appointment" | "waiting" | "task" | "capture";

export interface BriefingAction {
  kind: BriefingActionKind;
  id: string;
  title: string;
  /** Source-based explanation, e.g. "2 days overdue" or "You asked Carlos 5 days ago". */
  reason: string;
  href: string;
  /** Where the underlying record came from ("Gmail", "Google Calendar", ...). */
  sourceLabel: string;
}

export interface BriefingCalendarEntry {
  id: string;
  title: string;
  /** Clock label ("9:30 AM") only when the source stated an explicit time. */
  startLabel: string | null;
  location: string | null;
  href: string;
}

export interface FocusWindow {
  label: string;
  startLabel: string;
  endLabel: string;
  reason: string;
}

export interface MorningBriefing {
  date: string;
  /** Deterministic counts sentence ("You have 2 deadlines this week and 1 follow-up due."). */
  summary: string;
  actions: BriefingAction[];
  calendarToday: BriefingCalendarEntry[];
  focusWindow: FocusWindow | null;
  /** Stale/unavailable source labels — shown instead of guessing. */
  dataNotes: string[];
}

export interface EveningCheckinItem {
  kind: "task" | "deadline" | "appointment" | "waiting";
  id: string;
  title: string;
  href: string;
  note?: string;
}

export interface EveningCheckin {
  date: string;
  completedToday: EveningCheckinItem[];
  unfinished: EveningCheckinItem[];
  tomorrow: EveningCheckinItem[];
  waitingDue: EveningCheckinItem[];
  /** True when task completions were inferred from updatedAt (tasks have no completedAt). */
  approximateTaskCompletions: boolean;
}

// ---------------------------------------------------------------------------
// Timezone + clock helpers
// ---------------------------------------------------------------------------

/** User-local ISO date (YYYY-MM-DD) for an instant in an IANA timezone. */
export function isoDateInTimezone(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

/** Minutes after midnight in an IANA timezone. */
export function minutesInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => Number(s));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Quiet windows may wrap midnight (21:00 → 08:00). */
export function inQuietHours(minuteOfDay: number, start: string, end: string): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === e) return false;
  return s < e
    ? minuteOfDay >= s && minuteOfDay < e
    : minuteOfDay >= s || minuteOfDay < e;
}

/** 570 -> "9:30 AM". */
export function formatClock(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

function sourceLabelFor(entityType: string): string {
  switch (entityType) {
    case "gmail_message":
      return "Gmail";
    case "calendar_event":
      return "Google Calendar";
    case "capture_item":
      return "Capture";
    case "note":
      return "Note";
    case "manual":
      return "Manual";
    default:
      return "Recall";
  }
}

// ---------------------------------------------------------------------------
// Morning briefing
// ---------------------------------------------------------------------------

const ACTION_CAP = 5;
const PER_KIND_FIRST_PASS: Record<BriefingActionKind, number> = {
  deadline: 2,
  appointment: 2,
  waiting: 2,
  task: 1,
  capture: 1,
};

const URGENT_TASK_RE =
  /\b(urgent|asap|today|tonight|deadline|due|call|pay|submit|send|sign|appointment|inspection|blocked)\b/i;

/** Same signals as home-briefing's scoreTaskUrgency (see module note). */
export function scoreTaskForBriefing(task: RecallTaskDto, today: string): number {
  if (task.completed) return -1;
  const due = Boolean(task.time) && task.time!.slice(0, 10) <= today;
  const recent = daysBetween((task.updatedAt ?? task.createdAt).slice(0, 10), today) <= 7;
  if (!due && !recent) return -1;
  let score = 0;
  if (task.priority === "high") score += 40;
  if (task.priority === "med") score += 20;
  if (due) score += 45;
  if (URGENT_TASK_RE.test(task.title)) score += 20;
  // Stable, deterministic tie-break on age.
  score += Math.min(10, Math.max(0, daysBetween(task.createdAt.slice(0, 10), today)) / 7);
  return score;
}

function waitingBriefReason(w: WaitingItemDto, today: string): string {
  const expected = w.expectedAt?.slice(0, 10) ?? null;
  const promised = w.promisedAt?.slice(0, 10) ?? null;
  if (expected && expected < today) {
    const days = daysBetween(expected, today);
    return `${w.ownerName} — expected ${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (promised) {
    const days = daysBetween(promised, today);
    if (days >= 2) return `You asked ${w.ownerName} ${days} days ago`;
    return `You asked ${w.ownerName} ${days === 1 ? "yesterday" : "today"}`;
  }
  return `Follow-up with ${w.ownerName} is due`;
}

export function isWaitingDueForBriefing(w: WaitingItemDto, today: string): boolean {
  if (w.status !== "open" && w.status !== "snoozed") return false;
  const followUp = w.followUpAt?.slice(0, 10) ?? null;
  const expected = w.expectedAt?.slice(0, 10) ?? null;
  return Boolean(
    (followUp && followUp <= today) || (expected && expected < today),
  );
}

export function buildMorningBriefing(input: {
  date: string;
  now: Date;
  attention: AttentionItemDto[];
  waiting: WaitingItemDto[];
  tasks: RecallTaskDto[];
  captures: RecallCaptureItemDto[];
  financeNeedsSync?: boolean;
  /** Caller-computed stale connector notes, e.g. "Calendar last synced 2 days ago". */
  staleSources?: string[];
  /** IDs already surfaced elsewhere (review strip) — never double-surfaced. */
  excludeIds?: ReadonlySet<string>;
  timezone?: string | null;
}): MorningBriefing {
  const tz = input.timezone ?? recallTimezone();
  const exclude = input.excludeIds ?? new Set<string>();
  const today = input.date;

  const attention = input.attention.filter((a) => !exclude.has(a.id));
  const waiting = input.waiting.filter((w) => !exclude.has(w.id));
  const captures = input.captures.filter((c) => !exclude.has(c.id));

  const appointmentsToday = attention
    .filter((a) => a.kind === "appointment" && isoDateInTimezone(new Date(a.dueAt), tz) === today)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const deadlinesThisWeek = attention.filter((a) => {
    if (a.kind === "appointment") return false;
    const day = isoDateInTimezone(new Date(a.dueAt), tz);
    return day >= today && daysBetween(today, day) <= 7;
  });
  const overdueDeadlines = attention.filter((a) => attentionDueReason(a, input.now).overdue);
  const waitingDue = waiting.filter((w) => isWaitingDueForBriefing(w, today));

  const groups: BriefingAction[][] = [
    [...attention]
      .sort((a, b) => attentionUrgencyScore(b, input.now) - attentionUrgencyScore(a, input.now))
      .map((a): BriefingAction => ({
        kind: a.kind === "appointment" ? "appointment" : "deadline",
        id: a.id,
        title: a.title,
        reason: attentionDueReason(a, input.now).label,
        href: a.href,
        sourceLabel: sourceLabelFor(a.sourceEntityType),
      })),
    waitingDue.map((w): BriefingAction => ({
      kind: "waiting",
      id: w.id,
      title: w.deliverable,
      reason: waitingBriefReason(w, today),
      href: w.href,
      sourceLabel: sourceLabelFor(w.sourceEntityType),
    })),
    input.tasks
      .map((t) => ({ t, score: scoreTaskForBriefing(t, today) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ t }): BriefingAction => ({
        kind: "task",
        id: t.id,
        title: t.title,
        reason:
          t.time && t.time.slice(0, 10) <= today
            ? t.priority === "high"
              ? "High priority — due"
              : "Due"
            : t.priority === "high"
              ? "High priority"
              : "Active this week",
        href: `/tasks?task=${encodeURIComponent(t.id)}`,
        sourceLabel: "Tasks",
      })),
    captures
      .filter(
        (c) =>
          c.status === "pending" &&
          (c.autoAccepted || c.confidenceLabel === "high") &&
          daysBetween(c.createdAt.slice(0, 10), today) <= 3,
      )
      .map((c): BriefingAction => ({
        kind: "capture",
        id: c.id,
        title: c.cleanedTitle,
        reason: `High-confidence capture — ${c.suggestedType}`,
        href: `/inbox?capture=${encodeURIComponent(c.id)}`,
        sourceLabel: "Capture",
      })),
  ];

  // First pass: per-kind caps for diversity; second pass: fill by priority.
  const actions: BriefingAction[] = [];
  const leftovers: BriefingAction[] = [];
  const kinds: BriefingActionKind[] = ["deadline", "waiting", "task", "capture"];
  for (let g = 0; g < groups.length; g++) {
    const cap = PER_KIND_FIRST_PASS[kinds[g]!] ?? 1;
    actions.push(...groups[g]!.slice(0, cap));
    leftovers.push(...groups[g]!.slice(cap));
  }
  for (const extra of leftovers) {
    if (actions.length >= ACTION_CAP) break;
    actions.push(extra);
  }
  const capped = actions.slice(0, ACTION_CAP);

  // Deterministic summary — counts only, no invention.
  const parts: string[] = [];
  if (appointmentsToday.length) {
    parts.push(
      `${appointmentsToday.length} meeting${appointmentsToday.length === 1 ? "" : "s"} today`,
    );
  }
  if (deadlinesThisWeek.length) {
    parts.push(
      `${deadlinesThisWeek.length} deadline${deadlinesThisWeek.length === 1 ? "" : "s"} this week`,
    );
  }
  if (overdueDeadlines.length) {
    parts.push(`${overdueDeadlines.length} overdue`);
  }
  if (waitingDue.length) {
    parts.push(`${waitingDue.length} follow-up${waitingDue.length === 1 ? "" : "s"} due`);
  }
  const summary = parts.length
    ? `You have ${parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ")}.`
    : "Nothing urgent on your plate today.";

  const nowMin = minutesInTimezone(input.now, tz);
  const busy = appointmentsToday
    .filter((a) => a.timeKnown)
    .map((a) => {
      const start = minutesInTimezone(new Date(a.dueAt), tz);
      return { startMin: start, endMin: start + 60 }; // attention stores start only
    });
  // No time-known appointments means no calendar data to reason about — never
  // claim availability we can't see.
  const gap = busy.length > 0 ? findFocusWindow({ busy, nowMin }) : null;
  const focusWindow: FocusWindow | null = gap
    ? {
        label: `${formatClock(gap.startMin)} – ${formatClock(gap.endMin)}`,
        startLabel: formatClock(gap.startMin),
        endLabel: formatClock(gap.endMin),
        reason: `Largest open gap between your ${busy.length} meeting${busy.length === 1 ? "" : "s"} today`,
      }
    : null;

  const dataNotes: string[] = [...(input.staleSources ?? [])];
  if (input.financeNeedsSync) {
    dataNotes.push("Finance data hasn't synced recently — totals may be stale.");
  }

  return {
    date: today,
    summary,
    actions: capped,
    calendarToday: appointmentsToday.map((a) => ({
      id: a.id,
      title: a.title,
      startLabel: a.timeKnown
        ? formatClock(minutesInTimezone(new Date(a.dueAt), tz))
        : null,
      location:
        typeof a.metadata?.location === "string" && a.metadata.location
          ? a.metadata.location
          : null,
      href: a.href,
    })),
    focusWindow,
    dataNotes,
  };
}

// ---------------------------------------------------------------------------
// Focus window
// ---------------------------------------------------------------------------

/**
 * Find the first usable focus gap in the day. Appointments without an explicit
 * source time are excluded upstream (timeKnown) — we never guess availability
 * without calendar data, and return null when the day is full.
 */
export function findFocusWindow(input: {
  busy: { startMin: number; endMin: number }[];
  nowMin: number;
  dayStartMin?: number;
  dayEndMin?: number;
  minGapMin?: number;
}): { startMin: number; endMin: number } | null {
  const dayStart = input.dayStartMin ?? 8 * 60;
  const dayEnd = input.dayEndMin ?? 18 * 60;
  const minGap = input.minGapMin ?? 45;

  const busy = input.busy
    .map((b) => ({
      startMin: Math.max(dayStart, Math.min(dayEnd, b.startMin)),
      endMin: Math.max(dayStart, Math.min(dayEnd, b.endMin)),
    }))
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const gaps: { startMin: number; endMin: number }[] = [];
  let cursor = dayStart;
  for (const b of busy) {
    if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: b.startMin });
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < dayEnd) gaps.push({ startMin: cursor, endMin: dayEnd });

  const usable = gaps.filter((g) => g.endMin - g.startMin >= minGap && g.endMin > input.nowMin + 15);
  if (usable.length === 0) return null;
  // Clip a gap that started in the past to "from now".
  const first = usable[0]!;
  return { startMin: Math.max(first.startMin, input.nowMin + 15), endMin: first.endMin };
}

// ---------------------------------------------------------------------------
// Evening check-in
// ---------------------------------------------------------------------------

function toEveningItem(
  kind: EveningCheckinItem["kind"],
  id: string,
  title: string,
  href: string,
  note?: string,
): EveningCheckinItem {
  return { kind, id, title, href, note };
}

export function buildEveningCheckin(input: {
  date: string;
  tomorrowDate: string;
  now: Date;
  tasks: RecallTaskDto[];
  /** Open/seen attention rows (any due date). */
  attentionOpen: AttentionItemDto[];
  /** Recently completed/dismissed attention rows (for completedToday). */
  attentionTerminal: AttentionItemDto[];
  waiting: WaitingItemDto[];
}): EveningCheckin {
  const { date, tomorrowDate, now } = input;

  const completedToday: EveningCheckinItem[] = [];
  for (const a of input.attentionTerminal) {
    if (a.status === "completed" && a.completedAt?.slice(0, 10) === date) {
      completedToday.push(
        toEveningItem(a.kind === "appointment" ? "appointment" : "deadline", a.id, a.title, a.href),
      );
    }
  }
  for (const w of input.waiting) {
    if (w.status === "completed" && w.completedAt?.slice(0, 10) === date) {
      completedToday.push(toEveningItem("waiting", w.id, w.deliverable, w.href));
    }
  }
  const completedTasks = input.tasks.filter(
    (t) => t.completed && (t.updatedAt ?? t.createdAt).slice(0, 10) === date,
  );
  for (const t of completedTasks) {
    completedToday.push(
      toEveningItem("task", t.id, t.title, `/tasks?task=${encodeURIComponent(t.id)}`),
    );
  }

  const unfinished: EveningCheckinItem[] = [];
  for (const a of input.attentionOpen) {
    const day = a.dueAt.slice(0, 10);
    if (day <= date) {
      unfinished.push(
        toEveningItem(
          a.kind === "appointment" ? "appointment" : "deadline",
          a.id,
          a.title,
          a.href,
          attentionDueReason(a, now).label,
        ),
      );
    }
  }
  for (const t of input.tasks) {
    if (t.completed) continue;
    const due = Boolean(t.time) && t.time!.slice(0, 10) <= date;
    if (due || t.priority === "high") {
      unfinished.push(
        toEveningItem(
          "task",
          t.id,
          t.title,
          `/tasks?task=${encodeURIComponent(t.id)}`,
          due ? "Due" : "High priority",
        ),
      );
    }
  }

  const tomorrow: EveningCheckinItem[] = input.attentionOpen
    .filter((a) => a.dueAt.slice(0, 10) === tomorrowDate)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((a) =>
      toEveningItem(
        a.kind === "appointment" ? "appointment" : "deadline",
        a.id,
        a.title,
        a.href,
        a.timeKnown ? "Has a set time" : undefined,
      ),
    );

  const waitingDue: EveningCheckinItem[] = input.waiting
    .filter((w) => {
      if (w.status !== "open" && w.status !== "snoozed") return false;
      const followUp = w.followUpAt?.slice(0, 10) ?? null;
      const expected = w.expectedAt?.slice(0, 10) ?? null;
      return Boolean(
        (followUp && followUp <= tomorrowDate) || (expected && expected <= tomorrowDate),
      );
    })
    .map((w) =>
      toEveningItem("waiting", w.id, w.deliverable, w.href, waitingBriefReason(w, date)),
    );

  return {
    date,
    completedToday,
    unfinished,
    tomorrow,
    waitingDue,
    approximateTaskCompletions: completedTasks.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Briefing send gate (SMS sweep)
// ---------------------------------------------------------------------------

export interface BriefingSendPrefs {
  enabled: boolean;
  /** Local "HH:MM" target send time. */
  time: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** User-local ISO date of the last send (idempotency marker). */
  lastSentOn: string | null;
  timezone: string | null;
}

/**
 * Pure gate for the 60s sweep. Sends when: enabled, local time is past the
 * configured time, outside quiet hours, and not already sent on this local
 * date. A configured time inside quiet hours defers to the end of quiet
 * hours (the sweep keeps evaluating every minute).
 */
export function decideBriefingSend(
  prefs: BriefingSendPrefs,
  now: Date,
): { send: boolean; localDate: string } {
  const tz = prefs.timezone ?? recallTimezone();
  const localDate = isoDateInTimezone(now, tz);
  if (!prefs.enabled) return { send: false, localDate };
  if (prefs.lastSentOn === localDate) return { send: false, localDate };
  const nowMin = minutesInTimezone(now, tz);
  if (nowMin < timeToMinutes(prefs.time)) return { send: false, localDate };
  if (inQuietHours(nowMin, prefs.quietHoursStart, prefs.quietHoursEnd)) {
    return { send: false, localDate };
  }
  return { send: true, localDate };
}
