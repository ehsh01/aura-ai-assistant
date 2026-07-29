import { describe, expect, it } from "vitest";
import type { AttentionItemDto } from "./attention";
import type { WaitingItemDto } from "./waiting-items";
import type { RecallTaskDto } from "./tasks";
import type { RecallProjectDto } from "./projects";
import type { PersonDto } from "./people";
import type { AuditEntryDto } from "./audit";
import {
  buildLinkedPeople,
  buildProjectSummary,
  computeProjectRisks,
  decisionsFromAudit,
  pickProjectNextAction,
} from "./project-context";

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
    personId: null,
    projectId: "proj-1",
    taskId: null,
    organizationId: null,
    waitingItemId: null,
    dateConfidence: "certain",
    timeZone: null,
    timeKnown: false,
    confirmedAt: null,
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
    ownerPersonId: null,
    ownerName: "Carlos Rivera",
    ownerOrg: null,
    deliverable: "As-built documents",
    promisedAt: "2026-07-23T10:00:00Z",
    expectedAt: null,
    dateConfidence: "none",
    status: "open",
    followUpAt: "2026-08-02T09:00:00Z",
    snoozedUntil: null,
    completedAt: null,
    dismissedAt: null,
    lastOutcome: null,
    lastReplySourceRecordId: null,
    confidence: 0.8,
    threadId: null,
    sourceEntityType: "gmail_message",
    sourceEntityId: "sr-w",
    projectId: "proj-1",
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
    projectId: "proj-1",
    requesterPersonId: null,
    requesterPersonName: null,
    createdAt: "2026-07-27T09:00:00Z",
    updatedAt: "2026-07-27T09:00:00Z",
    ...partial,
  };
}

const emptyInput = { attention: [] as AttentionItemDto[], waiting: [] as WaitingItemDto[], tasks: [] as RecallTaskDto[], today: TODAY, now: NOW };

describe("computeProjectRisks", () => {
  it("flags overdue deadlines as high risk", () => {
    const risks = computeProjectRisks({
      ...emptyInput,
      attention: [attention({ id: "a-1", title: "Permit filing", dueAt: "2026-07-26T09:00:00Z" })],
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ severity: "high" });
    expect(risks[0]!.label).toContain("Permit filing");
  });

  it("flags overdue follow-ups high, due follow-ups medium, future follow-ups never", () => {
    const overdue = computeProjectRisks({
      ...emptyInput,
      waiting: [waiting({ id: "w-1", expectedAt: "2026-07-25T09:00:00Z" })],
    });
    expect(overdue[0]).toMatchObject({ severity: "high" });

    const due = computeProjectRisks({
      ...emptyInput,
      waiting: [waiting({ id: "w-2", followUpAt: `${TODAY}T09:00:00Z` })],
    });
    expect(due[0]).toMatchObject({ severity: "medium" });

    const future = computeProjectRisks({ ...emptyInput, waiting: [waiting({ id: "w-3" })] });
    expect(future).toEqual([]);
  });

  it("flags blocked-title tasks and never invents risks", () => {
    const risks = computeProjectRisks({
      ...emptyInput,
      tasks: [task({ id: "t-1", title: "Electrical work (blocked on inspection)" })],
    });
    expect(risks[0]).toMatchObject({ severity: "medium", label: expect.stringContaining("Blocked task") });
    expect(computeProjectRisks(emptyInput)).toEqual([]);
  });

  it("sorts high severity first", () => {
    const risks = computeProjectRisks({
      ...emptyInput,
      attention: [attention({ id: "a-1", title: "Overdue", dueAt: "2026-07-26T09:00:00Z" })],
      tasks: [task({ id: "t-1", title: "blocked task" })],
    });
    expect(risks.map((r) => r.severity)).toEqual(["high", "medium"]);
  });
});

describe("buildProjectSummary", () => {
  it("marks projects with high-severity risks as needing attention", () => {
    expect(
      buildProjectSummary({ openTasks: 2, deadlinesOpen: 1, waitingOpen: 1, notes: 3, captures: 0 }, true),
    ).toBe("2 open tasks, 1 open deadline, and 1 open follow-up — needs attention.");
  });

  it("stays neutral when there is no open work", () => {
    expect(
      buildProjectSummary({ openTasks: 0, deadlinesOpen: 0, waitingOpen: 0, notes: 1, captures: 0 }, false),
    ).toContain("No open work");
  });
});

describe("pickProjectNextAction", () => {
  it("prefers the oldest overdue deadline over waiting items", () => {
    const action = pickProjectNextAction({
      ...emptyInput,
      attention: [
        attention({ id: "a-new", title: "Later", dueAt: "2026-07-27T09:00:00Z" }),
        attention({ id: "a-old", title: "Earlier", dueAt: "2026-07-25T09:00:00Z" }),
      ],
      waiting: [waiting({ id: "w-1", followUpAt: `${TODAY}T09:00:00Z` })],
    });
    expect(action?.id).toBe("a-old");
    expect(action?.kind).toBe("deadline");
  });

  it("returns null when nothing is actionable", () => {
    expect(pickProjectNextAction(emptyInput)).toBeNull();
  });
});

describe("buildLinkedPeople", () => {
  const people: PersonDto[] = [
    {
      id: "p-carlos",
      displayName: "Carlos Rivera",
      firstName: null, lastName: null, email: null, phone: null,
      organization: null, department: null, role: null, notes: null,
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
    },
  ];
  const project: RecallProjectDto = {
    id: "proj-1", name: "Cabinet remodel", description: null, status: "active",
    relatedPeople: ["p-carlos"], noteCount: 0, taskCount: 0, captureCount: 0,
    attachmentCount: 0, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
  };

  it("unions associations across tasks, follow-ups, deadlines, notes, and project links", () => {
    const linked = buildLinkedPeople({
      project,
      people,
      tasks: [task({ id: "t-1", title: "Order hinges", requesterPersonId: "p-carlos" })],
      waiting: [waiting({ id: "w-1", ownerPersonId: "p-carlos" }), waiting({ id: "w-2", ownerName: "Permit Office", ownerPersonId: null })],
      attention: [attention({ id: "a-1", title: "Inspection", dueAt: "2026-08-01T09:00:00Z", personId: "p-carlos" })],
      notePersonIds: [null],
    });
    const carlos = linked.find((p) => p.id === "p-carlos");
    expect(carlos?.via).toEqual(["deadlines", "follow-ups", "project links", "tasks"]);
    expect(carlos?.href).toBe("/people/p-carlos");
    const office = linked.find((p) => p.name === "Permit Office");
    expect(office).toMatchObject({ id: null, via: ["follow-ups"], href: null });
  });
});

describe("decisionsFromAudit", () => {
  function entry(action: string, at: string, metadata: Record<string, unknown> = {}): AuditEntryDto {
    return { id: `au-${action}`, action, label: action.replace(/_/g, " "), entityType: "attention_item", entityId: "a-1", href: "/deadlines?item=a-1", metadata, createdAt: at };
  }

  it("keeps decision events, drops noise, and preserves order", () => {
    const decisions = decisionsFromAudit([
      entry("attention_confirmed", "2026-07-28T09:00:00Z", { title: "Permit filing" }),
      entry("query_answered", "2026-07-28T08:00:00Z"),
      entry("waiting_item_completed", "2026-07-27T10:00:00Z", { deliverable: "As-builts" }),
      entry("attention_updated", "2026-07-27T09:00:00Z"),
    ]);
    expect(decisions.map((d) => `${d.label}:${d.detail}`)).toEqual([
      "attention confirmed:Permit filing",
      "waiting item completed:As-builts",
    ]);
  });
});
