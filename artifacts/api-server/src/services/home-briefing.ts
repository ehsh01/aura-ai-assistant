/**
 * Server-side "daily briefing" home model.
 *
 * This replaces the client-side heuristics that used to run in the browser
 * (recall-app/src/lib/home-briefing.ts). Computing it here means:
 *   - the home screen reflects the user's full server data, not just what the
 *     client happened to have loaded,
 *   - the natural-language hero summary comes from a real AI call (with a
 *     deterministic fallback when AI is disabled), and
 *   - every client (web, future mobile, extension) gets the same briefing.
 *
 * The returned shapes mirror the props the existing home components expect,
 * including ready-to-use hrefs, so the frontend can render them directly.
 */
import { listCaptureInboxForUser, type RecallCaptureItemDto } from "./capture-items";
import { listNoteMetadataForUser, type RecallNoteMetadataDto } from "./notes";
import { listProjectsForUser, type RecallProjectDto } from "./projects";
import { listTasksForUser, type RecallTaskDto } from "./tasks";
import { loadSyncedFinanceAggregate } from "./finance-sync";
import { ensureUserFinanceFresh } from "./finance-auto-sync";
import { listWaitingOnForUser } from "./waiting-on";
import { listWaitingItemsForUser, type WaitingItemDto } from "./waiting-items";
import {
  attentionDueReason,
  listAttentionForToday,
  listDeadlinesForUser,
  type AttentionItemDto,
} from "./attention";
import { buildEveningCheckin, buildMorningBriefing, isoDateInTimezone, type MorningBriefing, type EveningCheckin } from "./briefing";
import { getBriefingPrefsForUser } from "./notification-settings";
import { buildProactiveInsights } from "./proactive-insights";
import { listOpenHomeyAlertsForUser } from "./homey-alerts";
import { todayIso, recallTimezone } from "./query-utils";
import { aiService } from "./ai";

// ---------------------------------------------------------------------------
// Response shapes (kept in sync with recall-app home components)
// ---------------------------------------------------------------------------

export interface BriefingItem {
  id: string;
  label: string;
  href: string;
}

export interface DailyBriefing {
  greeting: string;
  attentionCount: number;
  summary: string;
  critical: BriefingItem[];
  waiting: BriefingItem[];
  reminders: BriefingItem[];
  suggestedAction: { label: string; href: string } | null;
  /** True when the AI summary came from the deterministic fallback. */
  degraded: boolean;
  highlights: string[];
}

export interface FocusNow {
  title: string;
  reason: string;
  estimatedTime: string;
  actionLabel: string;
  href: string;
}

export type TimelineBucket = "Now" | "Next" | "Today" | "This Week";

export interface TimelineEntry {
  id: string;
  title: string;
  bucket: TimelineBucket;
  kind: "task" | "reminder" | "note";
  href: string;
  meta?: string;
}

export interface WaitingItem {
  id: string;
  person: string;
  personId: string | null;
  item: string;
  days: number;
  href: string;
  followUp: string;
  /** Present for durable tracked commitments: why it is surfacing now. */
  dueReason?: "needs_review" | "follow_up_due" | "expected_overdue";
}

// ---------------------------------------------------------------------------
// Review surface: every place Aura is waiting on a user confirmation.
// ---------------------------------------------------------------------------

export type ReviewQueue = "waiting" | "deadline" | "inbox";

export interface ReviewQueueItemDto {
  id: string;
  queue: ReviewQueue;
  title: string;
  detail: string;
  href: string;
}

export interface BriefingReview {
  waitingCandidates: number;
  unconfirmedDeadlines: number;
  inboxPending: number;
  total: number;
  /** Capped preview for the Today strip; counts above are always full. */
  items: ReviewQueueItemDto[];
}

/**
 * Assemble the "needs your confirmation" roll-up. Waiting candidates lead
 * (trust-critical), then unconfirmed deadlines by soonest due, then oldest
 * pending inbox items. Pure — unit-tested.
 */
export function buildReviewStrip(input: {
  waiting: WaitingItemDto[];
  attention: AttentionItemDto[];
  inbox: RecallCaptureItemDto[];
  limit?: number;
}): BriefingReview {
  const candidates = [...input.waiting]
    .filter((w) => w.status === "candidate")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Same "unconfirmed" definition as attentionDueReason (uncertain + not confirmed).
  const unconfirmed = [...input.attention]
    .filter((a) => attentionDueReason(a).unconfirmed)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const pending = [...input.inbox]
    .filter((c) => c.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const items: ReviewQueueItemDto[] = [
    ...candidates.map((w): ReviewQueueItemDto => ({
      id: w.id,
      queue: "waiting",
      title: w.deliverable.slice(0, 120),
      detail: w.candidateReason ?? `Confirm to track this follow-up with ${w.ownerName}`,
      href: w.href,
    })),
    ...unconfirmed.map((a): ReviewQueueItemDto => ({
      id: a.id,
      queue: "deadline",
      title: a.title.slice(0, 120),
      detail: `Confirm this date — due ${a.dueAt.slice(0, 10)}`,
      href: `/deadlines?item=${encodeURIComponent(a.id)}`,
    })),
    ...pending.map((c): ReviewQueueItemDto => ({
      id: c.id,
      queue: "inbox",
      title: c.cleanedTitle.slice(0, 120),
      detail: "Review this capture",
      href: inboxPath(c.id),
    })),
  ];

  const limit = Math.max(1, input.limit ?? 3);
  return {
    waitingCandidates: candidates.length,
    unconfirmedDeadlines: unconfirmed.length,
    inboxPending: pending.length,
    total: candidates.length + unconfirmed.length + pending.length,
    items: items.slice(0, limit),
  };
}

export type InsightKind =
  | "no-task"
  | "stale"
  | "follow-up"
  | "related"
  | "recurring-payment"
  | "project-change"
  | "warranty"
  | "invoice-due";

export interface InsightItem {
  id: string;
  kind: InsightKind;
  text: string;
  href?: string;
  evidence?: string;
}

export interface ContextArea {
  id: string;
  name: string;
  count: number;
  href: string;
  accent: string;
}

export interface FinanceSnapshot {
  total: number;
  transactionCount: number;
  rangeLabel: string;
  topPayee: { payee: string; total: number } | null;
  href: string;
  /** True when a finance connector exists but no synced rows yet. */
  needsSync: boolean;
}

export interface HomeBriefingResponse {
  date: string;
  briefing: DailyBriefing;
  focus: FocusNow | null;
  timeline: TimelineEntry[];
  waiting: WaitingItem[];
  dontForget: BriefingItem[];
  insights: InsightItem[];
  contextAreas: ContextArea[];
  finance: FinanceSnapshot | null;
  review: BriefingReview;
  morning: MorningBriefing;
}

// ---------------------------------------------------------------------------
// Nav helpers (mirror recall-app/src/lib/recall-nav.ts)
// ---------------------------------------------------------------------------

function notesPath(opts?: { noteId?: string; q?: string }): string {
  const params = new URLSearchParams();
  if (opts?.noteId) params.set("note", opts.noteId);
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  const q = params.toString();
  return q ? `/notes?${q}` : "/notes";
}

function tasksPath(taskId?: string): string {
  return taskId ? `/tasks?task=${encodeURIComponent(taskId)}` : "/tasks";
}

function inboxPath(captureId?: string): string {
  return captureId
    ? `/inbox?capture=${encodeURIComponent(captureId)}`
    : "/inbox";
}

function projectsPath(projectId?: string): string {
  return projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects";
}

// ---------------------------------------------------------------------------
// Heuristics (ported from the former client implementation)
// ---------------------------------------------------------------------------

const ACTION_PHRASE = /\b(need to|needs to|should|have to|must|remember to|todo|to-do|follow up|follow-up)\b/i;
const WAITING_RE = /\b(waiting|follow up|follow-up|call|email|reply|response|return|pending)\b/i;
const URGENCY_KEYWORDS = /\b(urgent|follow up|waiting|call|email|permit|inspection|ticket|asap|deadline|blocked)\b/i;

/** Home "pending" surfaces only show items from yesterday or today. */
const HOME_SURFACE_MAX_AGE_DAYS = 1;

function daysSince(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function isRecentForHome(iso?: string | null, maxAgeDays = HOME_SURFACE_MAX_AGE_DAYS): boolean {
  return daysSince(iso) <= maxAgeDays;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function isDueNowOrPast(value: string | null | undefined, today: string): boolean {
  if (!value) return false;
  // Support both YYYY-MM-DD and parseable timestamps.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10) <= today;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const d = date.toISOString().slice(0, 10);
  return d <= today;
}

function isDueToday(value: string | null | undefined, today: string): boolean {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10) === today;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === today;
}

function scoreTaskUrgency(task: RecallTaskDto, today: string): number {
  if (task.completed) return -1;
  const due = isDueNowOrPast(task.time ?? null, today);
  // Undated stale tasks must not dominate Focus / Start here. Due (or overdue)
  // tasks always stay eligible; everything else needs recent activity.
  if (!due && !isRecentForHome(task.updatedAt ?? task.createdAt)) return -1;
  let score = 0;
  if (task.priority === "high") score += 40;
  if (task.priority === "med") score += 20;
  if (due) score += 45;
  if (URGENCY_KEYWORDS.test(task.title)) score += 20;
  return score;
}

/**
 * Today is an action queue, not a capture inbox: only actionable or
 * time-sensitive captures surface. Everything else waits in the Inbox review
 * queue — so there is no base score, and a score of 0 means "exclude".
 */
export function scoreCaptureUrgency(item: RecallCaptureItemDto, today: string): number {
  if (item.status !== "pending") return -1;
  let score = 0;
  if (item.suggestedPriority === "urgent") score += 60;
  else if (item.suggestedPriority === "high") score += 40;
  if (isDueNowOrPast(item.suggestedDueDate, today)) score += 45;
  if (URGENCY_KEYWORDS.test(`${item.cleanedTitle} ${item.rawText}`)) score += 20;
  return score > 0 ? score : -1;
}

function rankedTasks(tasks: RecallTaskDto[], today: string): RecallTaskDto[] {
  return [...tasks]
    .map((task) => ({ task, score: scoreTaskUrgency(task, today) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.task);
}

function estimateTime(title: string): string {
  const t = title.toLowerCase();
  if (/\b(call|email|text|reply|message|ping)\b/.test(t)) return "~15 min";
  if (/\b(review|read|check|scan)\b/.test(t)) return "~20 min";
  if (/\b(plan|design|draft|write|build|redesign|prepare)\b/.test(t)) return "~45 min";
  return "~30 min";
}

function buildFocusNow(
  tasks: RecallTaskDto[],
  projects: RecallProjectDto[],
  today: string,
): FocusNow | null {
  const ranked = rankedTasks(tasks, today);
  const top = ranked[0];

  if (top) {
    let reason = "This is the highest-priority thing on your plate.";
    if (isDueToday(top.time ?? null, today)) reason = "It's due today ? best to clear it first.";
    else if (top.priority === "high") reason = "You flagged this as high priority.";
    else if (/\b(urgent|asap|deadline|blocked)\b/i.test(top.title))
      reason = "It looks time-sensitive based on how you described it.";
    return {
      title: top.title,
      reason,
      estimatedTime: estimateTime(top.title),
      actionLabel: "Start",
      href: tasksPath(top.id),
    };
  }

  const activeProject = [...projects]
    .filter((p) => p.status === "active")
    .sort((a, b) => b.taskCount + b.captureCount - (a.taskCount + a.captureCount))[0];

  if (activeProject) {
    const open = activeProject.taskCount + activeProject.captureCount;
    return {
      title: `Continue ${activeProject.name}`,
      reason:
        open > 0
          ? `Your most active project ? ${open} open item${open === 1 ? "" : "s"} waiting.`
          : "Your most active project right now.",
      estimatedTime: "~45 min",
      actionLabel: "Resume",
      href: projectsPath(activeProject.id),
    };
  }

  const firstOpen = tasks.find(
    (t) =>
      !t.completed &&
      (isDueNowOrPast(t.time ?? null, today) ||
        isRecentForHome(t.updatedAt ?? t.createdAt)),
  );
  if (firstOpen) {
    return {
      title: firstOpen.title,
      reason: "Next open task on your list.",
      estimatedTime: estimateTime(firstOpen.title),
      actionLabel: "Start",
      href: tasksPath(firstOpen.id),
    };
  }

  return null;
}

function buildTimeline(
  tasks: RecallTaskDto[],
  captures: RecallCaptureItemDto[],
  today: string,
): TimelineEntry[] {
  const ranked = rankedTasks(tasks, today);
  const used = new Set<string>();
  const entries: TimelineEntry[] = [];

  const pushTask = (task: RecallTaskDto, bucket: TimelineBucket) => {
    if (used.has(task.id)) return;
    used.add(task.id);
    entries.push({
      id: task.id,
      title: task.title,
      bucket,
      kind: "task",
      href: tasksPath(task.id),
      meta: task.time ?? undefined,
    });
  };

  if (ranked[0]) pushTask(ranked[0], "Now");
  ranked.slice(1, 3).forEach((t) => pushTask(t, "Next"));

  tasks
    .filter((t) => !t.completed && isDueToday(t.time ?? null, today))
    .slice(0, 3)
    .forEach((t) => pushTask(t, "Today"));

  captures
    .filter((c) => c.status === "pending" && isDueToday(c.suggestedDueDate, today))
    .slice(0, 3)
    .forEach((c) => {
      if (used.has(c.id)) return;
      used.add(c.id);
      entries.push({
        id: c.id,
        title: c.cleanedTitle,
        bucket: "Today",
        kind: "reminder",
        href: inboxPath(c.id),
        meta: c.suggestedDueDate ?? undefined,
      });
    });

  tasks
    .filter((t) => !t.completed)
    .slice(0, 4)
    .forEach((t) => pushTask(t, "This Week"));

  return entries;
}

async function buildWaitingOn(userId: string, limit = 4): Promise<WaitingItem[]> {
  const items = await listWaitingOnForUser(userId, limit);
  return items.map((w) => ({
    id: w.id,
    person: w.person,
    personId: w.personId,
    item: w.item,
    days: w.days,
    href: w.href,
    followUp: w.followUp,
    ...(w.dueReason ? { dueReason: w.dueReason } : {}),
  }));
}

function buildDontForget(
  notes: RecallNoteMetadataDto[],
  captures: RecallCaptureItemDto[],
  limit = 5,
): BriefingItem[] {
  const fromCaptures = captures
    .filter((c) => c.status === "pending" && isRecentForHome(c.createdAt))
    .map((c) => ({ id: c.id, label: c.cleanedTitle, href: inboxPath(c.id) }));
  const fromNotes = notes
    .filter(
      (n) =>
        isRecentForHome(n.updatedAt ?? n.createdAt) &&
        /\b(permit|inspection|renew|renewal|appointment|deadline|expire|expires|birthday|pay|due)\b/i.test(
          `${n.title} ${n.preview}`,
        ),
    )
    .map((n) => ({ id: n.id, label: n.title, href: notesPath({ noteId: n.id }) }));
  const seen = new Set<string>();
  return [...fromCaptures, ...fromNotes]
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .slice(0, limit);
}

function buildInsights(
  tasks: RecallTaskDto[],
  notes: RecallNoteMetadataDto[],
  captures: RecallCaptureItemDto[],
  projects: RecallProjectDto[],
  limit = 4,
): InsightItem[] {
  const insights: InsightItem[] = [];
  const taskTitles = tasks.map((t) => t.title.toLowerCase());
  const recentNotes = notes.filter((n) => isRecentForHome(n.updatedAt ?? n.createdAt));

  for (const note of recentNotes) {
    if (insights.length >= limit) break;
    if (!ACTION_PHRASE.test(`${note.title} ${note.preview}`)) continue;
    const overlaps = taskTitles.some((t) => t.includes(note.title.toLowerCase().slice(0, 12)));
    if (overlaps) continue;
    insights.push({
      id: `no-task-${note.id}`,
      kind: "no-task",
      text: `You mentioned ?${note.title}? but never turned it into a task.`,
      href: notesPath({ noteId: note.id }),
    });
  }

  for (const capture of captures) {
    if (insights.length >= limit) break;
    if (capture.status !== "pending") continue;
    if (!isRecentForHome(capture.createdAt)) continue;
    const age = daysSince(capture.createdAt);
    if (age < 1) continue;
    insights.push({
      id: `stale-${capture.id}`,
      kind: "stale",
      text: `?${capture.cleanedTitle}? has been sitting in your inbox since yesterday.`,
      href: inboxPath(capture.id),
    });
  }

  for (const note of recentNotes) {
    if (insights.length >= limit) break;
    if (!WAITING_RE.test(`${note.title} ${note.preview}`)) continue;
    insights.push({
      id: `follow-${note.id}`,
      kind: "follow-up",
      text: `?${note.title}? looks like it may need a follow-up.`,
      href: notesPath({ noteId: note.id }),
    });
  }

  if (insights.length < limit && projects.length > 0) {
    const project = projects[0]!;
    const related = recentNotes.find(
      (n) => n.projectId === project.id || n.tags.some((tag) => tag.toLowerCase() === project.name.toLowerCase()),
    );
    if (related) {
      insights.push({
        id: `related-${related.id}`,
        kind: "related",
        text: `?${related.title}? looks related to your ${project.name} project.`,
        href: notesPath({ noteId: related.id }),
      });
    }
  }

  return insights.slice(0, limit);
}

interface AreaDef {
  name: string;
  match: RegExp;
  search: string;
  accent: string;
}

const AREA_DEFS: AreaDef[] = [
  { name: "Psychiatry", match: /psychiatr|patient|clinic|dsm|medication|psych/i, search: "psychiatry", accent: "indigo" },
  { name: "Recall", match: /\brecall\b|dashboard|redesign/i, search: "recall", accent: "violet" },
  { name: "Budget", match: /budget|finance|money|expense|invoice|payment|bill/i, search: "budget", accent: "emerald" },
  { name: "Home", match: /household|home\b|maintenance|yard|repair/i, search: "home", accent: "amber" },
  { name: "Fence Lawsuit", match: /fence|lawsuit|legal|attorney|court|neighbor/i, search: "fence", accent: "rose" },
  { name: "House Construction", match: /construction|contractor|permit|renovation|\bbuild\b/i, search: "construction", accent: "sky" },
  { name: "Personal", match: /personal|family|health|gym|travel|birthday/i, search: "personal", accent: "pink" },
];

function buildContextAreas(
  notes: RecallNoteMetadataDto[],
  tasks: RecallTaskDto[],
  captures: RecallCaptureItemDto[],
  projects: RecallProjectDto[],
): ContextArea[] {
  const areas = AREA_DEFS.map((def) => {
    const noteCount = notes.filter((n) => def.match.test(`${n.title} ${n.preview} ${n.tags.join(" ")}`)).length;
    const taskCount = tasks.filter((t) => def.match.test(t.title)).length;
    const captureCount = captures.filter((c) => def.match.test(`${c.cleanedTitle} ${c.rawText}`)).length;
    const project = projects.find((p) => def.match.test(p.name));
    return {
      id: def.name,
      name: def.name,
      count: noteCount + taskCount + captureCount + (project ? project.noteCount + project.taskCount : 0),
      href: project ? projectsPath(project.id) : notesPath({ q: def.search }),
      accent: def.accent,
    };
  });

  return areas.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// AI hero summary
// ---------------------------------------------------------------------------

function fallbackSummary(attentionCount: number, parts: string[]): string {
  if (attentionCount === 0) {
    return "You're all caught up. Nothing needs your attention right now.";
  }
  const copy = [...parts];
  const last = copy.pop();
  const phrase = copy.length ? `${copy.join(", ")} and ${last}` : last;
  return `Here ${attentionCount === 1 ? "is" : "are"} the ${attentionCount} thing${
    attentionCount === 1 ? "" : "s"
  } that need your attention today ? ${phrase}.`;
}

/** This-month finance snapshot from already-synced source_records. */
async function buildFinanceSnapshot(userId: string, today: string): Promise<FinanceSnapshot | null> {
  // Refresh from MyFamilyBudget before reading (await so Home shows fresh totals).
  await ensureUserFinanceFresh(userId, { awaitSync: true });
  const synced = await loadSyncedFinanceAggregate(userId, "this month", today);
  if (!synced) return null;
  const top = synced.finance.topPayees[0] ?? null;
  // Home card is labeled "Spending" ? show dollars spent, not net.
  return {
    total: synced.finance.spent,
    transactionCount: synced.finance.expenseCount || synced.finance.count,
    rangeLabel: "this month",
    topPayee: top
      ? { payee: top.payee, total: Math.abs(top.total) }
      : null,
    href: "/connectors",
    needsSync: synced.needsSync,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildHomeBriefing(
  userId: string,
  userName: string,
): Promise<HomeBriefingResponse> {
  const today = todayIso();

  const [tasks, notes, captures, projects, finance, homeyAlerts, waitingAll, attentionDue, briefingPrefs] =
    await Promise.all([
      listTasksForUser(userId),
      listNoteMetadataForUser(userId),
      listCaptureInboxForUser(userId),
      listProjectsForUser(userId),
      buildFinanceSnapshot(userId, today),
      listOpenHomeyAlertsForUser(userId, { limit: 6, hours: 48 }),
      listWaitingItemsForUser(userId, { status: "all", limit: 100 }),
      listAttentionForToday(userId, 40),
      getBriefingPrefsForUser(userId),
    ]);

  const review = buildReviewStrip({
    waiting: waitingAll,
    attention: attentionDue,
    inbox: captures,
  });

  // Morning briefing actions must not double-surface items already sitting in
  // a review queue (candidates, unconfirmed deadlines, pending inbox).
  const reviewQueueIds = new Set<string>([
    ...waitingAll.filter((w) => w.status === "candidate").map((w) => w.id),
    ...attentionDue.filter((a) => attentionDueReason(a).unconfirmed).map((a) => a.id),
    ...captures.filter((c) => c.status === "pending").map((c) => c.id),
  ]);
  const userNow = new Date();
  const morning = buildMorningBriefing({
    date: isoDateInTimezone(userNow, briefingPrefs.timezone ?? recallTimezone()),
    now: userNow,
    attention: attentionDue,
    waiting: waitingAll,
    tasks,
    captures,
    financeNeedsSync: finance?.needsSync ?? false,
    excludeIds: reviewQueueIds,
    timezone: briefingPrefs.timezone,
  });

  const criticalFromTasks: BriefingItem[] = rankedTasks(tasks, today)
    .slice(0, 3)
    .map((t) => ({ id: t.id, label: t.title, href: tasksPath(t.id) }));

  const criticalFromHomey: BriefingItem[] = homeyAlerts
    .filter((a) => a.severity === "emergency" || a.severity === "warn")
    .slice(0, 4)
    .map((a) => ({
      id: a.id,
      label:
        a.severity === "emergency"
          ? `Homey emergency: ${a.title}`
          : `Homey: ${a.title}`,
      href: "/connectors",
    }));

  const critical: BriefingItem[] = [...criticalFromHomey, ...criticalFromTasks].slice(0, 5);

  const waitingBrief: BriefingItem[] = notes
    .filter(
      (n) =>
        isRecentForHome(n.updatedAt ?? n.createdAt) &&
        WAITING_RE.test(`${n.title} ${n.preview}`),
    )
    .slice(0, 3)
    .map((n) => ({ id: n.id, label: n.title, href: notesPath({ noteId: n.id }) }));

  const reminders: BriefingItem[] = captures
    .filter((c) => c.status === "pending" && isRecentForHome(c.createdAt))
    .map((c) => ({ item: c, score: scoreCaptureUrgency(c, today) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ item }) => ({ id: item.id, label: item.cleanedTitle, href: inboxPath(item.id) }));

  const focus = buildFocusNow(tasks, projects, today);
  const attentionCount =
    critical.length + waitingBrief.length + reminders.length + homeyAlerts.length;

  const parts: string[] = [];
  if (homeyAlerts.some((a) => a.severity === "emergency")) {
    parts.push("Homey emergency");
  } else if (homeyAlerts.length) {
    parts.push(`${homeyAlerts.length} home alert${homeyAlerts.length === 1 ? "" : "s"}`);
  }
  if (criticalFromTasks.length) parts.push(`${criticalFromTasks.length} urgent`);
  if (waitingBrief.length) parts.push(`${waitingBrief.length} waiting on others`);
  if (reminders.length) parts.push(`${reminders.length} to review`);

  // Natural-language hero: real AI when available, deterministic fallback otherwise.
  let summary = fallbackSummary(attentionCount, parts);
  let highlights: string[] = [];
  let degraded = true;
  try {
    const digest = await aiService.dashboardDigest({
      userName,
      tasks: tasks
        .filter((t) => !t.completed)
        .slice(0, 40)
        .map((t) => ({
          id: t.id,
          title: t.title,
          completed: t.completed,
          priority: t.priority,
          time: t.time ?? null,
          tags: t.tags,
        })),
      notes: notes
        .filter((n) => isRecentForHome(n.updatedAt ?? n.createdAt))
        .slice(0, 20)
        .map((n) => ({
          id: n.id,
          title: n.title,
          preview: n.preview,
          tags: n.tags,
        })),
    });
    if (digest.digest?.trim()) summary = digest.digest.trim();
    highlights = digest.highlights ?? [];
    degraded = digest.degraded;
  } catch {
    // Keep deterministic fallback summary.
  }

  const briefing: DailyBriefing = {
    greeting: `${greetingForHour(new Date().getHours())}, ${userName}.`,
    attentionCount,
    summary,
    critical,
    waiting: waitingBrief,
    reminders,
    suggestedAction: focus ? { label: focus.title, href: focus.href } : null,
    degraded,
    highlights,
  };

  const waiting = await buildWaitingOn(userId);
  const classicInsights = buildInsights(tasks, notes, captures, projects);
  const insights = await buildProactiveInsights(userId, {
    tasks,
    notes,
    projects,
    classic: classicInsights,
  });

  return {
    date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    briefing,
    focus,
    timeline: buildTimeline(tasks, captures, today),
    waiting,
    dontForget: buildDontForget(notes, captures),
    insights,
    contextAreas: buildContextAreas(notes, tasks, captures, projects),
    finance,
    review,
    morning,
  };
}

/** Orchestration for GET /checkin — all queries reused from existing services. */
export async function getEveningCheckinForUser(userId: string): Promise<EveningCheckin> {
  const prefs = await getBriefingPrefsForUser(userId);
  const tz = prefs.timezone ?? recallTimezone();
  const now = new Date();
  const date = isoDateInTimezone(now, tz);
  const tomorrowDate = isoDateInTimezone(new Date(now.getTime() + 86_400_000), tz);

  const [tasks, deadlines, waiting] = await Promise.all([
    listTasksForUser(userId),
    listDeadlinesForUser(userId),
    listWaitingItemsForUser(userId, { status: "all", limit: 100 }),
  ]);

  const attentionOpen = [
    ...deadlines.overdue,
    ...deadlines.today,
    ...deadlines.thisWeek,
    ...deadlines.later,
    ...deadlines.unconfirmed,
    ...deadlines.snoozed,
  ];

  return buildEveningCheckin({
    date,
    tomorrowDate,
    now,
    tasks,
    attentionOpen,
    attentionTerminal: deadlines.recentTerminal,
    waiting,
  });
}
