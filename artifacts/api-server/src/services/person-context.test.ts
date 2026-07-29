import { describe, expect, it } from "vitest";
import type { AttentionItemDto } from "./attention";
import type { WaitingItemDto } from "./waiting-items";
import type { RecallTaskDto } from "./tasks";
import {
  buildPersonSummary,
  buildPersonTimeline,
  pickPersonNextAction,
  type PersonContextStats,
} from "./person-context";

const NOW = new Date("2026-07-28T12:00:00Z");
const TODAY = "2026-07-28";

function attention(
  partial: Partial<AttentionItemDto> & Pick<AttentionItemDto, "id" | "title" | "dueAt">,
): AttentionItemDto {
  return {
    summary: null,
    kind: "deadline",
    status: "open",
    seenAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    completedAt: null,
    sourceEntityType: "gmail_message",
    sourceEntityId: "sr-1",
    evidenceText: null,
    personId: "p-1",
    projectId: null,
    taskId: null,
    organizationId: null,
    waitingItemId: null,
    dateConfidence: "certain",
    timeZone: null,
    timeKnown: false,
    confirmedAt: "2026-07-01T00:00:00Z",
    confidence: 0.9,
    metadata: {},
    href: `/deadlines?item=${partial.id}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
    ...partial,
  };
}

function waiting(partial: Partial<WaitingItemDto> & Pick<WaitingItemDto, "id">): WaitingItemDto {
  return {
    ownerPersonId: "p-1",
    ownerName: "Carlos",
    ownerOrg: null,
    deliverable: "Inspection confirmation",
    promisedAt: "2026-07-23T10:00:00Z",
    expectedAt: null,
    dateConfidence: "none",
    status: "open",
    followUpAt: `${TODAY}T09:00:00Z`,
    snoozedUntil: null,
    completedAt: null,
    dismissedAt: null,
    lastOutcome: null,
    lastReplySourceRecordId: null,
    confidence: 0.8,
    threadId: null,
    sourceEntityType: "gmail_message",
    sourceEntityId: "sr-w",
    projectId: null,
    taskId: null,
    needsReview: false,
    candidateReason: null,
    suggestedResolution: null,
    metadata: {},
    href: `/waiting/${partial.id}`,
    createdAt: "2026-07-23T10:00:00Z",
    updatedAt: "2026-07-23T10:00:00Z",
    ...partial,
  };
}

function task(partial: Partial<RecallTaskDto> & Pick<RecallTaskDto, "id" | "title">): RecallTaskDto {
  return {
    priority: "none",
    completed: false,
    projectId: null,
    requesterPersonId: "p-1",
    requesterPersonName: "Carlos",
    createdAt: "2026-07-27T09:00:00Z",
    updatedAt: "2026-07-27T09:00:00Z",
    ...partial,
  };
}

const emptyStats: PersonContextStats = {
  openTasks: 0,
  waitingOpen: 0,
  deadlinesOpen: 0,
  notes: 0,
  lastMessageAt: null,
};

describe("buildPersonSummary", () => {
  it("is honest when there is no activity", () => {
    expect(buildPersonSummary(emptyStats, "Carlos")).toBe(
      "No activity with Carlos yet — emails, tasks, and deadlines linked to them will appear here.",
    );
  });

  it("builds a grounded counts sentence", () => {
    const summary = buildPersonSummary(
      { openTasks: 2, waitingOpen: 1, deadlinesOpen: 1, notes: 4, lastMessageAt: "2026-07-25T15:00:00Z" },
      "Carlos",
    );
    expect(summary).toBe(
      "1 open follow-up from Carlos, 2 tasks you owe them, 1 linked deadline, and last email 2026-07-25.",
    );
  });
});

describe("pickPersonNextAction", () => {
  const base = { waiting: [] as WaitingItemDto[], attention: [] as AttentionItemDto[], tasks: [] as RecallTaskDto[], today: TODAY, now: NOW };

  it("returns null when nothing is high-confidence actionable", () => {
    expect(pickPersonNextAction(base)).toBeNull();
    // Low-confidence waiting item: surfaced in lists but not as next action.
    expect(
      pickPersonNextAction({ ...base, waiting: [waiting({ id: "w-low", confidence: 0.5 })] }),
    ).toBeNull();
  });

  it("prefers a due high-confidence waiting item with a plain-language reason", () => {
    const action = pickPersonNextAction({
      ...base,
      waiting: [waiting({ id: "w-1", confidence: 0.8 })],
      attention: [attention({ id: "a-1", title: "Deadline", dueAt: "2026-07-27T09:00:00Z" })],
    });
    expect(action?.kind).toBe("waiting");
    expect(action?.id).toBe("w-1");
    expect(action?.reason).toBe("You asked Carlos 5 days ago — time to follow up");
    expect(action?.sourceLabel).toBe("Gmail");
  });

  it("falls back to a confirmed overdue deadline, then a high-priority due task", () => {
    const deadlineAction = pickPersonNextAction({
      ...base,
      attention: [attention({ id: "a-1", title: "Permit filing", dueAt: "2026-07-27T09:00:00Z" })],
    });
    expect(deadlineAction?.kind).toBe("deadline");
    expect(deadlineAction?.reason).toMatch(/overdue/i);

    const taskAction = pickPersonNextAction({
      ...base,
      tasks: [task({ id: "t-1", title: "Send documents", priority: "high", time: TODAY })],
    });
    expect(taskAction?.kind).toBe("task");
    expect(taskAction?.reason).toBe("High priority — due");
  });

  it("ignores unconfirmed overdue deadlines", () => {
    expect(
      pickPersonNextAction({
        ...base,
        attention: [
          attention({ id: "a-1", title: "Uncertain", dueAt: "2026-07-27T09:00:00Z", confirmedAt: null, dateConfidence: "uncertain" }),
        ],
      }),
    ).toBeNull();
  });
});

describe("buildPersonTimeline", () => {
  it("merges sources newest-first and caps the list", () => {
    const timeline = buildPersonTimeline({
      messages: [
        { id: "m-1", title: "Re: permits", from: "Carlos", at: "2026-07-26T10:00:00Z", sourceUrl: "https://mail.example/1" },
        { id: "m-2", title: "Documents", from: "Carlos", at: "2026-07-20T10:00:00Z", sourceUrl: null },
      ],
      notes: [{ id: "n-1", title: "Call notes", updatedAt: "2026-07-27T09:00:00Z" }],
      tasks: [task({ id: "t-1", title: "Send documents", completed: true })],
      waiting: [waiting({ id: "w-1", status: "completed", completedAt: "2026-07-28T08:00:00Z" })],
      attention: [attention({ id: "a-1", title: "Inspection", dueAt: "2026-07-19T09:00:00Z" })],
    });
    expect(timeline.map((i) => `${i.kind}:${i.title}`)).toEqual([
      "waiting:Inspection confirmation",
      "note:Call notes",
      "task:Send documents",
      "message:Re: permits",
      "message:Documents",
      "deadline:Inspection",
    ]);
    expect(timeline.length).toBeLessThanOrEqual(12);
  });
});
