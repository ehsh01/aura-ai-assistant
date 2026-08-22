import { describe, expect, it } from "vitest";
import type { AttentionItemDto } from "./attention";
import type { RecallTaskDto } from "./tasks";
import type { WaitingItemDto } from "./waiting-items";
import type { WaitingOnItem } from "./waiting-on";
import {
  buildTodayDashboardCategories,
  type TodayDashboardInput,
} from "./today-dashboard";

const NOW = new Date("2026-08-22T12:00:00Z");

function task(overrides: Partial<RecallTaskDto> = {}): RecallTaskDto {
  return {
    id: "task-1",
    title: "Send permit revision",
    time: "2026-08-22",
    priority: "high",
    tags: [],
    completed: false,
    projectId: null,
    requesterPersonId: null,
    requesterPersonName: null,
    createdAt: "2026-08-15T12:00:00Z",
    updatedAt: "2026-08-21T12:00:00Z",
    ...overrides,
  };
}

function attention(overrides: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return {
    id: "attention-1",
    title: "Confirm permit inspection",
    summary: "City requested confirmation",
    dueAt: "2026-08-23T12:00:00Z",
    kind: "follow_up",
    status: "open",
    seenAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    completedAt: null,
    sourceEntityType: "source_record",
    sourceEntityId: "mail-1",
    evidenceText: "Please confirm Tuesday works.",
    personId: null,
    projectId: null,
    taskId: null,
    organizationId: null,
    waitingItemId: null,
    dateConfidence: "certain",
    timeZone: null,
    timeKnown: true,
    confirmedAt: "2026-08-20T12:00:00Z",
    confidence: 0.92,
    metadata: {},
    href: "/deadlines?item=attention-1",
    createdAt: "2026-08-20T12:00:00Z",
    updatedAt: "2026-08-20T12:00:00Z",
    ...overrides,
  };
}

function waiting(overrides: Partial<WaitingOnItem> = {}): WaitingOnItem {
  return {
    id: "mail:mail-1",
    person: "City Inspections",
    personId: null,
    item: "Permit inspector still has not confirmed",
    days: 11,
    href: "/ask",
    followUp: "Follow up with City Inspections",
    sourceType: "mail",
    evidenceText: "Please confirm Tuesday works.",
    ...overrides,
  };
}

function trackedWaiting(overrides: Partial<WaitingItemDto> = {}): WaitingItemDto {
  return {
    id: "wait-1",
    ownerPersonId: null,
    ownerName: "Mike",
    ownerOrg: null,
    deliverable: "Contractor bid",
    promisedAt: "2026-08-15T12:00:00Z",
    expectedAt: null,
    dateConfidence: "none",
    status: "open",
    followUpAt: null,
    snoozedUntil: null,
    completedAt: null,
    dismissedAt: null,
    lastOutcome: null,
    lastReplySourceRecordId: null,
    confidence: 0.8,
    threadId: null,
    sourceEntityType: "task",
    sourceEntityId: "task-wait",
    projectId: null,
    taskId: "task-wait",
    needsReview: false,
    candidateReason: null,
    suggestedResolution: null,
    metadata: { evidenceSnippet: "Mike said the bid was coming Friday." },
    href: "/waiting/wait-1",
    createdAt: "2026-08-15T12:00:00Z",
    updatedAt: "2026-08-15T12:00:00Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<TodayDashboardInput> = {}): TodayDashboardInput {
  return {
    now: NOW,
    tasks: [],
    attention: [],
    waiting: [],
    trackedWaiting: [],
    subscriptions: [],
    finance: null,
    gmailSources: [],
    gmailConnected: false,
    financeConnected: false,
    ...overrides,
  };
}

describe("buildTodayDashboardCategories", () => {
  it("always returns the eight fixed categories, including calm zero states", () => {
    const categories = buildTodayDashboardCategories(baseInput());

    expect(categories.map((category) => category.key)).toEqual([
      "email",
      "payments",
      "important",
      "due-soon",
      "cracks",
      "waiting",
      "focus",
      "finance",
    ]);
    expect(categories).toHaveLength(8);
    expect(categories.every((category) => category.count === 0)).toBe(true);
    expect(categories.find((category) => category.key === "email")?.emptyAction).toBe(
      "Connect Gmail",
    );
  });

  it("counts actionable Gmail threads once even when two views reference the same thread", () => {
    const categories = buildTodayDashboardCategories(
      baseInput({
        waiting: [waiting()],
        attention: [attention()],
        gmailConnected: true,
        gmailSources: [
          {
            id: "mail-1",
            title: "Permit inspection Tuesday",
            text: "Please confirm Tuesday works.",
            sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
            sourceCreatedAt: "2026-08-11T12:00:00Z",
            metadata: { threadId: "thread-1" },
          },
        ],
      }),
    );

    const email = categories.find((category) => category.key === "email");
    expect(email?.count).toBe(1);
    expect(email?.items[0]).toMatchObject({
      title: "Permit inspection Tuesday",
      source: "Gmail",
      href: "https://mail.google.com/mail/u/0/#inbox/thread-1",
    });
  });

  it("keeps Important tight, includes overdue through seven days in Due soon, and caps Focus at three", () => {
    const categories = buildTodayDashboardCategories(
      baseInput({
        tasks: [
          task({ id: "overdue", time: "2026-08-20", priority: "none" }),
          task({ id: "high", time: undefined, priority: "high" }),
          task({ id: "soon", time: "2026-08-29", priority: "med" }),
          task({ id: "later", time: "2026-09-20", priority: "none" }),
        ],
      }),
    );

    const important = categories.find((category) => category.key === "important");
    const dueSoon = categories.find((category) => category.key === "due-soon");
    const focus = categories.find((category) => category.key === "focus");

    expect(important?.items.map((item) => item.id)).toEqual([
      "task:overdue",
      "task:high",
    ]);
    expect(dueSoon?.items.map((item) => item.id)).toEqual([
      "task:overdue",
      "task:soon",
    ]);
    expect(focus?.items).toHaveLength(3);
    expect(focus?.items[0]?.id).toBe("task:overdue");
  });

  it("builds Cracks from open waits silent five days or more and sorts most stale first", () => {
    const categories = buildTodayDashboardCategories(
      baseInput({
        waiting: [
          waiting({ id: "task:recent", sourceType: "task", days: 3 }),
          waiting({ id: "task:stale", sourceType: "task", days: 6 }),
        ],
        trackedWaiting: [trackedWaiting()],
      }),
    );

    const cracks = categories.find((category) => category.key === "cracks");
    expect(cracks?.items.map((item) => item.daysSilent)).toEqual([7, 6]);
    expect(cracks?.items.map((item) => item.title)).toEqual([
      "Contractor bid",
      "Permit inspector still has not confirmed",
    ]);
  });

  it("derives near-term subscriptions and finance inclusion from ledger classifications", () => {
    const categories = buildTodayDashboardCategories(
      baseInput({
        financeConnected: true,
        subscriptions: [
          {
            payee: "Cloud Storage",
            occurrenceCount: 6,
            avgAmount: 12.99,
            avgAmountFormatted: "$12.99",
            lastDate: "2026-07-25",
            cadenceDays: 30,
            confidence: "high",
          },
          {
            payee: "Far Away",
            occurrenceCount: 4,
            avgAmount: 20,
            avgAmountFormatted: "$20.00",
            lastDate: "2026-07-01",
            cadenceDays: 30,
            confidence: "medium",
          },
        ],
        finance: {
          connectorId: "finance-1",
          needsSync: false,
          payeeFilter: null,
          finance: {
            total: -100,
            spent: 100,
            income: 0,
            count: 2,
            expenseCount: 1,
            incomeCount: 0,
            rangeLabel: "this month",
            topPayees: [{ payee: "Grocer", total: 100, count: 1 }],
            topCategories: [{ category: "Food", total: 100, count: 1 }],
            formatted: {
              net: "-$100.00",
              spent: "$100.00",
              income: "$0.00",
              topPayees: [{ payee: "Grocer", total: "$100.00", count: 1 }],
              topCategories: [{ category: "Food", total: "$100.00", count: 1 }],
            },
            transactions: [
              {
                date: "2026-08-21",
                payee: "Grocer",
                amount: -100,
                amountFormatted: "-$100.00",
                category: "Food",
                kind: "expense",
              },
              {
                date: "2026-08-20",
                payee: "Card payment",
                amount: -500,
                amountFormatted: "-$500.00",
                category: "Transfer",
                kind: "credit_card_payment",
              },
            ],
            transfersExcluded: true,
            classificationCounts: {
              expense: 1,
              income: 0,
              transfer: 0,
              credit_card_payment: 1,
              refund: 0,
            },
          },
        },
      }),
    );

    const payments = categories.find((category) => category.key === "payments");
    const finance = categories.find((category) => category.key === "finance");
    expect(payments?.items.map((item) => item.title)).toEqual(["Cloud Storage"]);
    expect(finance?.heroAmount).toBe(100);
    expect(finance?.items.map((item) => item.inclusion)).toEqual([
      "included",
      "excluded",
    ]);
  });
});
