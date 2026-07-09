import { and, desc, eq } from "drizzle-orm";
import { captures, tasks } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listCaptureInboxForUser } from "./capture-items";

export type TodayItem = {
  id: string;
  kind: "task" | "capture" | "inbox";
  title: string;
  reason: string;
  dueOrTime: string | null;
  priority: string | null;
  href: string;
};

export type TodayResponse = {
  mustDo: TodayItem[];
  overdue: TodayItem[];
  waiting: TodayItem[];
  inbox: TodayItem[];
  suggestedFocus: TodayItem | null;
};

function isOverdue(time: string | null | undefined): boolean {
  if (!time) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(time)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return time < today;
}

function isDueToday(time: string | null | undefined): boolean {
  if (!time) return false;
  const today = new Date().toISOString().slice(0, 10);
  return time === today || time.startsWith(today);
}

export async function buildTodayForUser(userId: string): Promise<TodayResponse> {
  const taskRows = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.completed, false)))
    .orderBy(desc(tasks.updatedAt));

  const inboxItems = await listCaptureInboxForUser(userId);

  const pendingCaptures = await getDb()
    .select()
    .from(captures)
    .where(and(eq(captures.userId, userId), eq(captures.processedStatus, "pending")))
    .orderBy(desc(captures.capturedAt))
    .limit(10);

  const mustDo: TodayItem[] = [];
  const overdue: TodayItem[] = [];
  const waiting: TodayItem[] = [];

  for (const t of taskRows) {
    const item: TodayItem = {
      id: t.id,
      kind: "task",
      title: t.title,
      reason: isOverdue(t.time) ? "Overdue task" : isDueToday(t.time) ? "Due today" : "Open task",
      dueOrTime: t.time ?? null,
      priority: t.priority,
      href: "/tasks",
    };
    if (isOverdue(t.time)) overdue.push(item);
    else if (isDueToday(t.time) || t.priority === "high") mustDo.push(item);
    else if ((t.tags ?? []).includes("waiting") || (t.tags ?? []).includes("follow-up")) {
      waiting.push(item);
    }
  }

  const inbox: TodayItem[] = inboxItems.slice(0, 8).map((item) => ({
    id: item.id,
    kind: "inbox" as const,
    title: item.cleanedTitle,
    reason: "Needs review in AI Inbox",
    dueOrTime: item.suggestedDueDate,
    priority: item.suggestedPriority,
    href: "/inbox",
  }));

  for (const c of pendingCaptures) {
    inbox.push({
      id: c.id,
      kind: "capture",
      title: c.title ?? "Untitled capture",
      reason: "Raw capture awaiting processing",
      dueOrTime: null,
      priority: null,
      href: "/inbox",
    });
  }

  const suggestedFocus =
    mustDo[0] ?? overdue[0] ?? inbox[0] ?? waiting[0] ?? null;

  return { mustDo, overdue, waiting, inbox, suggestedFocus };
}
