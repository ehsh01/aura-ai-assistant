/**
 * Derives the AI "daily briefing" home model from real Recall data.
 *
 * These are grounded heuristics (priority, due dates, keywords, recency) that
 * stand in for server-side AI. Each builder returns a typed shape so the
 * components can later be fed real AI output without changing the UI.
 */
import type {
  RecallCaptureItem,
  RecallNote,
  RecallProject,
  RecallTask,
} from "@/lib/recall-context";
import { notesPath, tasksPath, inboxPath, projectsPath } from "@/lib/recall-nav";
import { scoreCaptureUrgency, scoreTaskUrgency } from "@/lib/urgency";

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
  item: string;
  days: number;
  href: string;
  followUp: string;
}

export type InsightKind = "no-task" | "stale" | "follow-up" | "related";

export interface InsightItem {
  id: string;
  kind: InsightKind;
  text: string;
  href?: string;
}

export interface ContextArea {
  id: string;
  name: string;
  count: number;
  href: string;
  accent: string;
}

const ACTION_PHRASE = /\b(need to|needs to|should|have to|must|remember to|todo|to-do|follow up|follow-up)\b/i;
const WAITING_RE = /\b(waiting|follow up|follow-up|call|email|reply|response|return|pending)\b/i;

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function isDueToday(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}

function rankedTasks(tasks: RecallTask[]): RecallTask[] {
  return [...tasks]
    .map((task) => ({ task, score: scoreTaskUrgency(task) }))
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

export function buildFocusNow(
  tasks: RecallTask[],
  projects: RecallProject[],
): FocusNow | null {
  const ranked = rankedTasks(tasks);
  const top = ranked[0];

  if (top) {
    let reason = "This is the highest-priority thing on your plate.";
    if (isDueToday(top.time)) reason = "It's due today — best to clear it first.";
    else if (top.priority === "high") reason = "You flagged this as high priority.";
    else if (/\b(urgent|asap|deadline|blocked)\b/i.test(top.title))
      reason = "It looks time-sensitive based on how you described it.";
    return {
      title: top.title,
      reason,
      estimatedTime: estimateTime(top.title),
      actionLabel: "Start",
      href: tasksPath({ taskId: top.id }),
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
          ? `Your most active project — ${open} open item${open === 1 ? "" : "s"} waiting.`
          : "Your most active project right now.",
      estimatedTime: "~45 min",
      actionLabel: "Resume",
      href: projectsPath(activeProject.id),
    };
  }

  const firstOpen = tasks.find((t) => !t.completed);
  if (firstOpen) {
    return {
      title: firstOpen.title,
      reason: "Next open task on your list.",
      estimatedTime: estimateTime(firstOpen.title),
      actionLabel: "Start",
      href: tasksPath({ taskId: firstOpen.id }),
    };
  }

  return null;
}

export function buildDailyBriefing(
  userName: string,
  tasks: RecallTask[],
  notes: RecallNote[],
  captures: RecallCaptureItem[],
  projects: RecallProject[],
): DailyBriefing {
  const greeting = greetingForHour(new Date().getHours());

  const critical: BriefingItem[] = rankedTasks(tasks)
    .slice(0, 3)
    .map((t) => ({ id: t.id, label: t.title, href: tasksPath({ taskId: t.id }) }));

  const waiting: BriefingItem[] = notes
    .filter((n) => WAITING_RE.test(`${n.title} ${n.preview}`))
    .slice(0, 3)
    .map((n) => ({ id: n.id, label: n.title, href: notesPath({ noteId: n.id }) }));

  const reminders: BriefingItem[] = captures
    .filter((c) => c.status === "pending")
    .map((c) => ({ item: c, score: scoreCaptureUrgency(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ item }) => ({ id: item.id, label: item.cleanedTitle, href: inboxPath() }));

  const focus = buildFocusNow(tasks, projects);
  const attentionCount = critical.length + waiting.length + reminders.length;

  let summary: string;
  if (attentionCount === 0) {
    summary = "You're all caught up. Nothing needs your attention right now.";
  } else {
    const parts: string[] = [];
    if (critical.length) parts.push(`${critical.length} urgent`);
    if (waiting.length) parts.push(`${waiting.length} waiting on others`);
    if (reminders.length) parts.push(`${reminders.length} to review`);
    const last = parts.pop();
    const phrase = parts.length ? `${parts.join(", ")} and ${last}` : last;
    summary = `Here ${attentionCount === 1 ? "is" : "are"} the ${attentionCount} thing${attentionCount === 1 ? "" : "s"} that need your attention today — ${phrase}.`;
  }

  return {
    greeting: `${greeting}, ${userName}.`,
    attentionCount,
    summary,
    critical,
    waiting,
    reminders,
    suggestedAction: focus ? { label: focus.title, href: focus.href } : null,
  };
}

export function buildTimeline(
  tasks: RecallTask[],
  captures: RecallCaptureItem[],
): TimelineEntry[] {
  const ranked = rankedTasks(tasks);
  const used = new Set<string>();
  const entries: TimelineEntry[] = [];

  const pushTask = (task: RecallTask, bucket: TimelineBucket) => {
    if (used.has(task.id)) return;
    used.add(task.id);
    entries.push({
      id: task.id,
      title: task.title,
      bucket,
      kind: "task",
      href: tasksPath({ taskId: task.id }),
      meta: task.time ?? undefined,
    });
  };

  if (ranked[0]) pushTask(ranked[0], "Now");
  ranked.slice(1, 3).forEach((t) => pushTask(t, "Next"));

  tasks
    .filter((t) => !t.completed && isDueToday(t.time))
    .slice(0, 3)
    .forEach((t) => pushTask(t, "Today"));

  captures
    .filter((c) => c.status === "pending" && isDueToday(c.suggestedDueDate))
    .slice(0, 3)
    .forEach((c) => {
      if (used.has(c.id)) return;
      used.add(c.id);
      entries.push({
        id: c.id,
        title: c.cleanedTitle,
        bucket: "Today",
        kind: "reminder",
        href: inboxPath(),
        meta: c.suggestedDueDate ?? undefined,
      });
    });

  tasks
    .filter((t) => !t.completed)
    .slice(0, 4)
    .forEach((t) => pushTask(t, "This Week"));

  return entries;
}

function extractPerson(text: string): string {
  const near = text.match(/\b(?:from|for|with|on|by)\s+([A-Z][a-z]+)/);
  if (near) return near[1]!;
  const dash = text.match(/^([A-Z][a-z]+)\s*[—:-]/);
  if (dash) return dash[1]!;
  const cap = text.match(/\b([A-Z][a-z]{2,})\b/);
  if (cap && !/^(The|This|That|Follow|Waiting|Email|Call)$/.test(cap[1]!)) return cap[1]!;
  return "Someone";
}

export function buildWaitingOn(notes: RecallNote[], limit = 4): WaitingItem[] {
  return notes
    .filter((n) => WAITING_RE.test(`${n.title} ${n.preview}`))
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      person: extractPerson(`${n.title} ${n.preview}`),
      item: n.title,
      days: daysSince(n.updatedAt ?? n.createdAt),
      href: notesPath({ noteId: n.id }),
      followUp: "Follow up",
    }));
}

export function buildDontForget(
  notes: RecallNote[],
  captures: RecallCaptureItem[],
  limit = 5,
): BriefingItem[] {
  const fromCaptures = captures
    .filter((c) => c.status === "pending")
    .map((c) => ({ id: c.id, label: c.cleanedTitle, href: inboxPath() }));
  const fromNotes = notes
    .filter((n) =>
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

export function buildInsights(
  tasks: RecallTask[],
  notes: RecallNote[],
  captures: RecallCaptureItem[],
  projects: RecallProject[],
  limit = 4,
): InsightItem[] {
  const insights: InsightItem[] = [];
  const taskTitles = tasks.map((t) => t.title.toLowerCase());

  for (const note of notes) {
    if (insights.length >= limit) break;
    if (!ACTION_PHRASE.test(`${note.title} ${note.preview}`)) continue;
    const overlaps = taskTitles.some((t) => t.includes(note.title.toLowerCase().slice(0, 12)));
    if (overlaps) continue;
    insights.push({
      id: `no-task-${note.id}`,
      kind: "no-task",
      text: `You mentioned “${note.title}” but never turned it into a task.`,
      href: notesPath({ noteId: note.id }),
    });
  }

  for (const capture of captures) {
    if (insights.length >= limit) break;
    if (capture.status !== "pending") continue;
    const age = daysSince(capture.createdAt);
    if (age < 3) continue;
    insights.push({
      id: `stale-${capture.id}`,
      kind: "stale",
      text: `“${capture.cleanedTitle}” has been sitting in your inbox for ${age} days.`,
      href: inboxPath(),
    });
  }

  for (const note of notes) {
    if (insights.length >= limit) break;
    if (!WAITING_RE.test(`${note.title} ${note.preview}`)) continue;
    insights.push({
      id: `follow-${note.id}`,
      kind: "follow-up",
      text: `“${note.title}” looks like it may need a follow-up.`,
      href: notesPath({ noteId: note.id }),
    });
  }

  if (insights.length < limit && projects.length > 0) {
    const project = projects[0]!;
    const related = notes.find(
      (n) => n.projectId === project.id || n.tags.some((tag) => tag.toLowerCase() === project.name.toLowerCase()),
    );
    if (related) {
      insights.push({
        id: `related-${related.id}`,
        kind: "related",
        text: `“${related.title}” looks related to your ${project.name} project.`,
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

export function buildContextAreas(
  notes: RecallNote[],
  tasks: RecallTask[],
  captures: RecallCaptureItem[],
  projects: RecallProject[],
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
