import { and, eq, inArray } from "drizzle-orm";
import { sourceRecords } from "@workspace/db/schema";
import { getDb } from "../lib/db";
import { listAttentionForToday, type AttentionItemDto } from "./attention";
import { listConnectorsForUser } from "./connectors";
import {
  loadSyncedFinanceAggregate,
  type SyncedFinanceResult,
} from "./finance-sync";
import { listSubscriptionHeuristicsForUser, type SubscriptionHeuristic } from "./subscriptions";
import { listTasksForUser, type RecallTaskDto } from "./tasks";
import {
  listWaitingItemsForUser,
  type WaitingItemDto,
} from "./waiting-items";
import {
  listWaitingOnForUser,
  type WaitingOnItem,
} from "./waiting-on";
import { todayIso } from "./query-utils";

export type TodayCategoryKey =
  | "email"
  | "payments"
  | "important"
  | "due-soon"
  | "cracks"
  | "waiting"
  | "focus"
  | "finance";

export type TodayDashboardEvidence = {
  entityType: string;
  entityId: string;
  text: string;
  system: string;
  occurredAt: string | null;
  url: string | null;
};

export type TodayDashboardItem = {
  id: string;
  title: string;
  context: string;
  source: string;
  href: string;
  evidence: TodayDashboardEvidence;
  daysSilent?: number;
  dueAt?: string | null;
  reason?: string | null;
  amount?: number | null;
  inclusion?: "included" | "excluded" | null;
};

export type TodayDashboardCategory = {
  key: TodayCategoryKey;
  eyebrow: string;
  title: string;
  count: number;
  summary: string;
  items: TodayDashboardItem[];
  emptyTitle: string;
  emptyAction: string | null;
  emptyHref: string | null;
  heroAmount?: number;
  heroCurrency?: "USD";
  period?: string;
  flags?: string[];
};

export type TodayDashboardResponse = {
  date: string;
  generatedAt: string;
  categories: TodayDashboardCategory[];
};

type GmailSource = {
  id: string;
  title: string;
  text: string;
  sourceUrl: string | null;
  sourceCreatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type TodayDashboardInput = {
  now: Date;
  tasks: RecallTaskDto[];
  attention: AttentionItemDto[];
  waiting: WaitingOnItem[];
  trackedWaiting: WaitingItemDto[];
  subscriptions: SubscriptionHeuristic[];
  finance: SyncedFinanceResult | null;
  gmailSources: GmailSource[];
  gmailConnected: boolean;
  financeConnected: boolean;
};

const DAY_MS = 86_400_000;

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayDistance(value: string | null | undefined, now: Date): number | null {
  const date = parseDate(value);
  if (!date) return null;
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

function daysSince(value: string | null | undefined, now: Date): number {
  const distance = dayDistance(value, now);
  return distance == null ? 0 : Math.max(0, -distance);
}

function dateLabel(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function relativeDueLabel(value: string | null | undefined, now: Date): string {
  const distance = dayDistance(value, now);
  if (distance == null) return "Date unavailable";
  if (distance < 0) return `${Math.abs(distance)}d overdue`;
  if (distance === 0) return "Due today";
  if (distance === 1) return "Due tomorrow";
  return `Due in ${distance}d`;
}

function entityFromWaiting(item: WaitingOnItem): {
  entityType: string;
  entityId: string;
} {
  const split = item.id.indexOf(":");
  const rawType = split > 0 ? item.id.slice(0, split) : item.sourceType;
  const entityId = split > 0 ? item.id.slice(split + 1) : item.id;
  const entityType =
    rawType === "durable"
      ? "waiting_item"
      : rawType === "mail"
        ? "source_record"
        : rawType;
  return { entityType, entityId };
}

function taskItem(
  task: RecallTaskDto,
  context: string,
  reason: string,
): TodayDashboardItem {
  return {
    id: `task:${task.id}`,
    title: task.title,
    context,
    source: "Task",
    href: `/tasks?task=${encodeURIComponent(task.id)}`,
    evidence: {
      entityType: "task",
      entityId: task.id,
      text: task.title,
      system: "Recall tasks",
      occurredAt: task.updatedAt,
      url: null,
    },
    dueAt: task.time ?? null,
    reason,
  };
}

function attentionItem(
  item: AttentionItemDto,
  context: string,
  source = "Attention",
): TodayDashboardItem {
  return {
    id: `attention:${item.id}`,
    title: item.title,
    context,
    source,
    href: `/deadlines?item=${encodeURIComponent(item.id)}`,
    evidence: {
      entityType: "attention_item",
      entityId: item.id,
      text: item.evidenceText ?? item.summary ?? item.title,
      system: source === "Gmail" ? "Gmail" : "Recall attention",
      occurredAt: item.createdAt,
      url: null,
    },
    dueAt: item.dueAt,
    reason: item.summary,
  };
}

function waitingItem(item: WaitingOnItem): TodayDashboardItem {
  const entity = entityFromWaiting(item);
  const source =
    item.sourceType === "mail"
      ? "Gmail"
      : item.sourceType === "durable"
        ? "Waiting"
        : item.sourceType;
  return {
    id: `waiting:${item.id}`,
    title: item.item,
    context: `Waiting on ${item.person} · ${item.days}d silent`,
    source,
    href: item.href,
    evidence: {
      ...entity,
      text: item.evidenceText,
      system: source === "Gmail" ? "Gmail" : `Recall ${source}`,
      occurredAt: null,
      url: null,
    },
    daysSilent: item.days,
    reason: item.followUp,
  };
}

function trackedWaitingToWaitingOn(
  item: WaitingItemDto,
  now: Date,
  gmailById: Map<string, GmailSource>,
): WaitingOnItem {
  const gmail =
    item.sourceEntityType === "source_record"
      ? gmailById.get(item.sourceEntityId)
      : undefined;
  const sourceType: WaitingOnItem["sourceType"] = gmail ? "mail" : "durable";
  return {
    id: gmail ? `mail:${gmail.id}` : `durable:${item.id}`,
    person: item.ownerName,
    personId: item.ownerPersonId,
    item: item.deliverable,
    days: daysSince(item.promisedAt ?? item.createdAt, now),
    href: item.href,
    followUp: `Follow up with ${item.ownerName}`,
    sourceType,
    evidenceText:
      (typeof item.metadata?.evidenceSnippet === "string"
        ? item.metadata.evidenceSnippet
        : item.deliverable
      ).slice(0, 500),
  };
}

function dedupeWaiting(items: WaitingOnItem[]): WaitingOnItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const entity = entityFromWaiting(item);
    const key = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addDays(value: string, days: number): string | null {
  const date = parseDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
}

function focusReason(task: RecallTaskDto, now: Date): string {
  const distance = dayDistance(task.time, now);
  if (distance != null && distance < 0) return `${Math.abs(distance)} days overdue`;
  if (distance === 0) return "Due today";
  if (task.priority === "high") return "Marked high priority";
  if (task.requesterPersonName) return `${task.requesterPersonName} is waiting on this`;
  return "Recently active and ready to move";
}

function focusScore(task: RecallTaskDto, now: Date): number {
  if (task.completed) return -1;
  let score = task.priority === "high" ? 50 : task.priority === "med" ? 25 : 0;
  const distance = dayDistance(task.time, now);
  if (distance != null) {
    if (distance < 0) score += 80 + Math.min(Math.abs(distance), 30);
    else if (distance === 0) score += 70;
    else if (distance <= 7) score += 35 - distance;
  }
  score += Math.max(0, 10 - daysSince(task.updatedAt, now));
  return score;
}

function gmailThreadKey(source: GmailSource | undefined, fallback: string): string {
  const threadId = source?.metadata?.threadId;
  return typeof threadId === "string" && threadId ? threadId : fallback;
}

function withGmailEvidence(
  item: TodayDashboardItem,
  source: GmailSource | undefined,
): TodayDashboardItem {
  if (!source) return item;
  return {
    ...item,
    title: source.title || item.title,
    context: item.context,
    source: "Gmail",
    href: source.sourceUrl ?? item.href,
    evidence: {
      ...item.evidence,
      text: source.text || item.evidence.text,
      system: "Gmail",
      occurredAt: source.sourceCreatedAt ?? item.evidence.occurredAt,
      url: source.sourceUrl,
    },
  };
}

export function buildTodayDashboardCategories(
  input: TodayDashboardInput,
): TodayDashboardCategory[] {
  const { now } = input;
  const gmailById = new Map(input.gmailSources.map((row) => [row.id, row]));
  const tracked = input.trackedWaiting
    .filter((item) => item.status === "open")
    .map((item) => trackedWaitingToWaitingOn(item, now, gmailById));
  const waiting = dedupeWaiting([...tracked, ...input.waiting]);

  const emailByThread = new Map<string, TodayDashboardItem>();
  for (const item of waiting.filter((row) => row.sourceType === "mail")) {
    const entity = entityFromWaiting(item);
    const gmail = gmailById.get(entity.entityId);
    const key = gmailThreadKey(gmail, entity.entityId);
    if (!emailByThread.has(key)) {
      emailByThread.set(key, withGmailEvidence(waitingItem(item), gmail));
    }
  }
  for (const item of input.attention) {
    if (item.sourceEntityType !== "source_record") continue;
    const gmail = gmailById.get(item.sourceEntityId);
    if (!gmail) continue;
    const key = gmailThreadKey(gmail, item.sourceEntityId);
    if (!emailByThread.has(key)) {
      emailByThread.set(
        key,
        withGmailEvidence(
          attentionItem(item, `${relativeDueLabel(item.dueAt, now)} · actionable message`, "Gmail"),
          gmail,
        ),
      );
    }
  }
  const email = [...emailByThread.values()].sort((a, b) => {
    const aTime = parseDate(a.evidence.occurredAt)?.getTime() ?? 0;
    const bTime = parseDate(b.evidence.occurredAt)?.getTime() ?? 0;
    return aTime - bTime;
  });

  const payments = input.subscriptions
    .map((subscription): TodayDashboardItem | null => {
      if (!subscription.cadenceDays) return null;
      const nextAt = addDays(subscription.lastDate, subscription.cadenceDays);
      const distance = dayDistance(nextAt, now);
      if (distance == null || distance < -14 || distance > 14) return null;
      const context =
        distance < 0
          ? `${subscription.avgAmountFormatted} · expected ${Math.abs(distance)}d ago`
          : distance === 0
            ? `${subscription.avgAmountFormatted} · expected today`
            : `${subscription.avgAmountFormatted} · expected in ${distance}d`;
      return {
        id: `subscription:${subscription.payee}`,
        title: subscription.payee,
        context,
        source: "Ledger",
        href: "/connectors",
        evidence: {
          entityType: "finance_subscription",
          entityId: subscription.payee,
          text: `${subscription.occurrenceCount} ledger charges; median cadence ${subscription.cadenceDays} days; last charge ${subscription.lastDate}.`,
          system: "Finance ledger",
          occurredAt: subscription.lastDate,
          url: null,
        },
        dueAt: nextAt,
        amount: subscription.avgAmount,
        reason: `${subscription.confidence} confidence recurring charge`,
      };
    })
    .filter((item): item is TodayDashboardItem => item !== null)
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));

  const openTasks = input.tasks.filter((task) => !task.completed);
  const importantTaskRows = openTasks
    .filter((task) => {
      const distance = dayDistance(task.time, now);
      return task.priority === "high" || (distance != null && distance <= 0);
    })
    .map((task) =>
      taskItem(
        task,
        `${relativeDueLabel(task.time, now)}${task.priority === "high" ? " · high priority" : ""}`,
        task.priority === "high" ? "High priority task" : "Due or overdue",
      ),
    );
  const importantAttentionRows = input.attention
    .filter((item) => {
      const distance = dayDistance(item.dueAt, now);
      return distance != null && distance <= 0;
    })
    .map((item) => attentionItem(item, relativeDueLabel(item.dueAt, now)));
  const important = [...importantTaskRows, ...importantAttentionRows].sort((a, b) =>
    a.dueAt && b.dueAt
      ? a.dueAt.localeCompare(b.dueAt)
      : a.dueAt
        ? -1
        : b.dueAt
          ? 1
          : 0,
  );

  const dueSoonTasks = openTasks
    .filter((task) => {
      const distance = dayDistance(task.time, now);
      return distance != null && distance <= 7;
    })
    .map((task) =>
      taskItem(task, `${relativeDueLabel(task.time, now)} · ${dateLabel(task.time)}`, "Due soon"),
    );
  const dueSoonAttention = input.attention
    .filter((item) => {
      const distance = dayDistance(item.dueAt, now);
      return distance != null && distance <= 7;
    })
    .map((item) =>
      attentionItem(
        item,
        `${relativeDueLabel(item.dueAt, now)} · ${item.kind.replace("_", " ")}`,
      ),
    );
  const dueSoon = [...dueSoonTasks, ...dueSoonAttention].sort((a, b) =>
    (a.dueAt ?? "").localeCompare(b.dueAt ?? ""),
  );

  const waitingRows = waiting
    .map(waitingItem)
    .sort((a, b) => (b.daysSilent ?? 0) - (a.daysSilent ?? 0));
  const cracks = waitingRows.filter((item) => (item.daysSilent ?? 0) >= 5);

  const focus = openTasks
    .map((task) => ({ task, score: focusScore(task, now) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ task }) => {
      const reason = focusReason(task, now);
      return taskItem(task, `${reason} · suggested next`, reason);
    });

  const financeTransactions: TodayDashboardItem[] =
    input.finance?.finance.transactions.map((transaction, index) => {
      const included = transaction.kind === "expense";
      return {
        id: `finance:${transaction.date}:${index}`,
        title: transaction.payee,
        context: `${transaction.amountFormatted} · ${transaction.category ?? "Uncategorized"} · ${dateLabel(transaction.date)}`,
        source: "Ledger",
        href: "/connectors",
        evidence: {
          entityType: "finance_transaction",
          entityId: `${transaction.date}:${index}`,
          text: `${transaction.payee} ${transaction.amountFormatted}; classified as ${transaction.kind}.`,
          system: "Finance ledger",
          occurredAt: transaction.date,
          url: null,
        },
        amount: transaction.amount,
        inclusion: included ? "included" : "excluded",
        reason: included ? "Included in period spend" : "Excluded from period spend",
      };
    }) ?? [];
  const financeFlags: string[] = [];
  if (input.finance?.needsSync) financeFlags.push("Sync needed");
  if (payments.length > 0) {
    financeFlags.push(`${payments.length} upcoming recurring charge${payments.length === 1 ? "" : "s"}`);
  }

  const financeTotal = input.finance?.finance.spent ?? 0;
  const financePeriod = input.finance?.finance.rangeLabel ?? "this month";
  const financeSummary = input.finance
    ? input.finance.needsSync
      ? "sync needed"
      : `${financePeriod} · ${financeFlags.length} flag${financeFlags.length === 1 ? "" : "s"}`
    : input.financeConnected
      ? "waiting for the first ledger sync"
      : "connect a finance ledger";

  return [
    {
      key: "email",
      eyebrow: "Gmail",
      title: "Email",
      count: email.length,
      summary: "needs a reply",
      items: email,
      emptyTitle: input.gmailConnected ? "No actionable mail" : "Connect Gmail to find actionable threads",
      emptyAction: input.gmailConnected ? null : "Connect Gmail",
      emptyHref: input.gmailConnected ? null : "/connectors",
    },
    {
      key: "payments",
      eyebrow: "Finance",
      title: "Payments & subscriptions",
      count: payments.length,
      summary: "due in about 14 days",
      items: payments,
      emptyTitle: input.financeConnected
        ? "No recurring charges expected soon"
        : "Connect finance to track recurring charges",
      emptyAction: input.financeConnected ? null : "Connect finance",
      emptyHref: input.financeConnected ? null : "/connectors",
    },
    {
      key: "important",
      eyebrow: "Attention",
      title: "Important",
      count: important.length,
      summary: "must do now",
      items: important,
      emptyTitle: "Nothing urgent right now",
      emptyAction: null,
      emptyHref: null,
    },
    {
      key: "due-soon",
      eyebrow: "Tasks",
      title: "Due soon",
      count: dueSoon.length,
      summary: "today + 7 days",
      items: dueSoon,
      emptyTitle: "Nothing due in the next seven days",
      emptyAction: "Review tasks",
      emptyHref: "/tasks",
    },
    {
      key: "cracks",
      eyebrow: "Stale",
      title: "Falling through the cracks",
      count: cracks.length,
      summary: "silent 5+ days",
      items: cracks,
      emptyTitle: "Nothing has gone quiet",
      emptyAction: null,
      emptyHref: null,
    },
    {
      key: "waiting",
      eyebrow: "People",
      title: "Waiting on",
      count: waitingRows.length,
      summary: "open waits",
      items: waitingRows,
      emptyTitle: "You are not waiting on anyone",
      emptyAction: "Track a follow-up",
      emptyHref: "/waiting",
    },
    {
      key: "focus",
      eyebrow: "Suggested",
      title: "Focus",
      count: focus.length,
      summary: "do these next · cap 3",
      items: focus,
      emptyTitle: "No next action to suggest",
      emptyAction: "Review tasks",
      emptyHref: "/tasks",
    },
    {
      key: "finance",
      eyebrow: "Synced",
      title: "Finance snapshot",
      count: financeTransactions.length,
      summary: financeSummary,
      items: financeTransactions,
      emptyTitle: input.financeConnected
        ? "No ledger rows in this period"
        : "Connect finance to see period spend",
      emptyAction: "Open finance connections",
      emptyHref: "/connectors",
      heroAmount: financeTotal,
      heroCurrency: "USD",
      period: financePeriod,
      flags: financeFlags.slice(0, 2),
    },
  ];
}

async function gmailSourcesForUser(
  userId: string,
  sourceIds: string[],
): Promise<GmailSource[]> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({
      id: sourceRecords.id,
      title: sourceRecords.recordTitle,
      text: sourceRecords.recordText,
      sourceUrl: sourceRecords.sourceUrl,
      sourceCreatedAt: sourceRecords.sourceCreatedAt,
      metadata: sourceRecords.recordMetadata,
    })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.userId, userId),
        eq(sourceRecords.recordType, "gmail_message"),
        inArray(sourceRecords.id, ids),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "Email",
    text: row.text ?? row.title ?? "Email message",
    sourceUrl: row.sourceUrl ?? null,
    sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
    metadata: row.metadata ?? {},
  }));
}

export async function buildTodayDashboardForUser(
  userId: string,
): Promise<TodayDashboardResponse> {
  const now = new Date();
  const today = todayIso();
  const [tasks, attention, waiting, trackedWaiting, subscriptions, connectors, finance] =
    await Promise.all([
      listTasksForUser(userId),
      listAttentionForToday(userId, 200),
      listWaitingOnForUser(userId, {
        limit: 200,
        minAgeDays: 0,
        maxAgeDays: 3650,
      }),
      listWaitingItemsForUser(userId, { status: "open", limit: 200 }),
      listSubscriptionHeuristicsForUser(userId, 50),
      listConnectorsForUser(userId),
      loadSyncedFinanceAggregate(userId, "this month", today, {
        skipPayeeHint: true,
      }),
    ]);

  const sourceIds = [
    ...attention
      .filter((item) => item.sourceEntityType === "source_record")
      .map((item) => item.sourceEntityId),
    ...waiting
      .filter((item) => item.sourceType === "mail")
      .map((item) => item.id.replace(/^mail:/, "")),
    ...trackedWaiting
      .filter((item) => item.sourceEntityType === "source_record")
      .map((item) => item.sourceEntityId),
  ];
  const gmailSources = await gmailSourcesForUser(userId, sourceIds);
  const gmailConnected = connectors.some(
    (connector) => connector.type === "google" && connector.enabled,
  );
  const financeConnected = connectors.some(
    (connector) => connector.type === "finance_api" && connector.enabled,
  );

  return {
    date: now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    generatedAt: now.toISOString(),
    categories: buildTodayDashboardCategories({
      now,
      tasks,
      attention,
      waiting,
      trackedWaiting,
      subscriptions,
      finance,
      gmailSources,
      gmailConnected,
      financeConnected,
    }),
  };
}

export const todayDashboardFormatMoney = formatMoney;
