import type { RecallCaptureItem, RecallNote, RecallProject, RecallTask } from "@/lib/recall-context";

const KEYWORDS = /\b(urgent|follow up|waiting|call|email|permit|inspection|ticket|asap|deadline|blocked)\b/i;

function isDueNow(value?: string | null): boolean {
  if (!value) return false;
  const today = new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}

export function scoreTaskUrgency(task: RecallTask): number {
  let score = 0;
  if (task.completed) return -1;
  if (task.priority === "high") score += 40;
  if (task.priority === "med") score += 20;
  if (isDueNow(task.time)) score += 45;
  if (KEYWORDS.test(task.title)) score += 20;
  return score;
}

export function scoreCaptureUrgency(item: RecallCaptureItem): number {
  if (item.status !== "pending") return -1;
  let score = 5;
  if (item.suggestedPriority === "urgent") score += 60;
  if (item.suggestedPriority === "high") score += 40;
  if (isDueNow(item.suggestedDueDate)) score += 45;
  if (KEYWORDS.test(`${item.cleanedTitle} ${item.rawText}`)) score += 20;
  return score;
}

export function urgentTasks(tasks: RecallTask[], limit = 5): RecallTask[] {
  return [...tasks]
    .map((task) => ({ task, score: scoreTaskUrgency(task) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.task);
}

export function waitingNotes(notes: RecallNote[], limit = 5): RecallNote[] {
  return notes
    .filter((note) => /\b(waiting|follow up|call|email|ticket)\b/i.test(`${note.title} ${note.preview}`))
    .slice(0, limit);
}

export function workFollowUps(notes: RecallNote[], tasks: RecallTask[], limit = 5) {
  const fromTasks = tasks
    .filter((task) => !task.completed && /\b(ticket|vpn|outlook|printer|server|support|user)\b/i.test(task.title))
    .map((task) => ({ id: task.id, title: task.title, kind: "task" as const }));
  const fromNotes = notes
    .filter((note) => /\b(ticket|vpn|outlook|printer|server|support|user)\b/i.test(`${note.title} ${note.preview}`))
    .map((note) => ({ id: note.id, title: note.title, kind: "note" as const }));
  return [...fromTasks, ...fromNotes].slice(0, limit);
}

export function thingsYouMayForget(notes: RecallNote[], captures: RecallCaptureItem[], limit = 5): string[] {
  const captureTitles = captures
    .filter((item) => item.status === "pending")
    .map((item) => item.cleanedTitle);
  const noteTitles = notes
    .filter((note) => /\b(permit|inspection|renew|appointment|deadline|follow up)\b/i.test(`${note.title} ${note.preview}`))
    .map((note) => note.title);
  return [...captureTitles, ...noteTitles].slice(0, limit);
}

export function personalProjects(projects: RecallProject[], limit = 5): RecallProject[] {
  return projects
    .filter((project) => project.status === "active")
    .sort((a, b) => b.taskCount + b.captureCount - (a.taskCount + a.captureCount))
    .slice(0, limit);
}

export type PressingKind = "task" | "capture" | "note" | "homey";

export interface PressingItem {
  key: string;
  id: string;
  title: string;
  kind: PressingKind;
  reason: string;
  score: number;
}

export type HomeyUrgencyAlert = {
  id: string;
  title: string;
  severity: "info" | "warn" | "emergency";
  deviceName?: string | null;
};

const WAITING_RE = /\b(waiting|follow up|follow-up|call|email|reply|response|ticket)\b/i;
const FORGET_RE = /\b(permit|inspection|renew|renewal|appointment|deadline|expire|expires|due)\b/i;

function taskReason(task: RecallTask): string {
  if (isDueNow(task.time)) return "Due";
  if (task.priority === "high") return "High";
  if (KEYWORDS.test(task.title)) return "Follow-up";
  return "Task";
}

/** One ranked list merging urgent tasks, pending captures, time-sensitive notes, and Homey alerts. */
export function pressingFeed(
  tasks: RecallTask[],
  notes: RecallNote[],
  captures: RecallCaptureItem[],
  limit = 6,
  homeyAlerts: HomeyUrgencyAlert[] = [],
): PressingItem[] {
  const items: PressingItem[] = [];

  for (const alert of homeyAlerts) {
    const score =
      alert.severity === "emergency" ? 120 : alert.severity === "warn" ? 70 : 25;
    items.push({
      key: `homey-${alert.id}`,
      id: alert.id,
      title: alert.deviceName ? `${alert.title} (${alert.deviceName})` : alert.title,
      kind: "homey",
      reason: alert.severity === "emergency" ? "Emergency" : "Homey",
      score,
    });
  }

  for (const task of tasks) {
    const score = scoreTaskUrgency(task);
    if (score <= 0) continue;
    items.push({
      key: `task-${task.id}`,
      id: task.id,
      title: task.title,
      kind: "task",
      reason: taskReason(task),
      score,
    });
  }

  for (const item of captures) {
    const score = scoreCaptureUrgency(item);
    if (score <= 0) continue;
    items.push({
      key: `capture-${item.id}`,
      id: item.id,
      title: item.cleanedTitle,
      kind: "capture",
      reason: "Inbox",
      score,
    });
  }

  for (const note of notes) {
    const hay = `${note.title} ${note.preview}`;
    let score = 0;
    let reason = "";
    if (WAITING_RE.test(hay)) {
      score = 28;
      reason = "Waiting";
    } else if (FORGET_RE.test(hay)) {
      score = 24;
      reason = "Don't forget";
    }
    if (score <= 0) continue;
    items.push({ key: `note-${note.id}`, id: note.id, title: note.title, kind: "note", reason, score });
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}
