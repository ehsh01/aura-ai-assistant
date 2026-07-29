import { describe, expect, it } from "vitest";
import type { AttentionItemDto } from "./attention";
import type { WaitingItemDto } from "./waiting-items";
import type { RecallTaskDto } from "./tasks";
import type { RecallProjectDto } from "./projects";
import type { PersonDto } from "./people";
import { computeLinkSuggestions, nameMatchStrength } from "./link-suggestions";

const PEOPLE: PersonDto[] = [
  {
    id: "p-carlos",
    displayName: "Carlos Rivera",
    firstName: "Carlos",
    lastName: "Rivera",
    email: "carlos@example.com",
    phone: null,
    organization: null,
    department: null,
    role: null,
    notes: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  },
];

const PROJECTS: RecallProjectDto[] = [
  {
    id: "proj-cabinet",
    name: "Cabinet remodel",
    description: null,
    status: "active",
    relatedPeople: [],
    noteCount: 0,
    taskCount: 0,
    captureCount: 0,
    attachmentCount: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  },
];

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
    projectId: null,
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
    followUpAt: "2026-07-28T09:00:00Z",
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
    requesterPersonId: null,
    requesterPersonName: null,
    createdAt: "2026-07-27T09:00:00Z",
    updatedAt: "2026-07-27T09:00:00Z",
    ...partial,
  };
}

const base = {
  people: PEOPLE,
  projects: PROJECTS,
  attention: [] as AttentionItemDto[],
  waiting: [] as WaitingItemDto[],
  tasks: [] as RecallTaskDto[],
};

describe("nameMatchStrength", () => {
  it("scores full-name whole-word matches highest", () => {
    expect(nameMatchStrength("Carlos Rivera", "Call Carlos Rivera about permits")).toBe(2);
    expect(nameMatchStrength("Carlos Rivera", "carlos rivera sent the files")).toBe(2);
    expect(nameMatchStrength("Carlos Rivera", "Rivera, please ask Carlos")).toBe(1);
    expect(nameMatchStrength("Carlos Rivera", "Carlos said hi")).toBe(0); // single part only
    expect(nameMatchStrength("Carlos Rivera", "unrelated text")).toBe(0);
    expect(nameMatchStrength("Carlos Rivera", "Carlosisms abound")).toBe(0); // word boundary
  });
});

describe("computeLinkSuggestions", () => {
  it("suggests linking a waiting item's unmatched owner to the known person", () => {
    const suggestions = computeLinkSuggestions({ ...base, waiting: [waiting({ id: "w-1" })] });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      entityType: "waiting_item",
      entityId: "w-1",
      field: "ownerPersonId",
      suggestedId: "p-carlos",
      confidence: "high",
    });
    expect(suggestions[0]!.reason).toContain("Carlos Rivera");
  });

  it("suggests person and project links for attention items from title/evidence", () => {
    const suggestions = computeLinkSuggestions({
      ...base,
      attention: [
        attention({
          id: "a-1",
          title: "Cabinet remodel inspection sign-off",
          dueAt: "2026-07-30T09:00:00Z",
          evidenceText: "From: Carlos Rivera — I'll bring the plans",
        }),
      ],
    });
    const person = suggestions.find((s) => s.field === "personId");
    const project = suggestions.find((s) => s.field === "projectId");
    expect(person).toMatchObject({ suggestedId: "p-carlos", confidence: "high" });
    expect(project).toMatchObject({ suggestedId: "proj-cabinet", confidence: "high" });
  });

  it("never suggests for terminal/done records or existing links", () => {
    const suggestions = computeLinkSuggestions({
      ...base,
      waiting: [
        waiting({ id: "w-done", status: "completed" }),
        waiting({ id: "w-linked", ownerPersonId: "p-carlos" }),
      ],
      tasks: [
        task({ id: "t-done", title: "Carlos Rivera paperwork", completed: true }),
        task({ id: "t-linked", title: "Carlos Rivera paperwork", requesterPersonId: "p-carlos" }),
      ],
    });
    expect(suggestions).toEqual([]);
  });

  it("does not match partial names for projects (noise control)", () => {
    const suggestions = computeLinkSuggestions({
      ...base,
      tasks: [task({ id: "t-1", title: "Buy cabinet hinges" })], // "cabinet" ≠ "Cabinet remodel"
    });
    expect(suggestions.find((s) => s.suggestedKind === "project")).toBeUndefined();
  });

  it("sorts high confidence first and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      waiting({ id: `w-${i}`, ownerName: "Carlos Rivera" }),
    );
    const suggestions = computeLinkSuggestions({ ...base, waiting: many, limit: 20 });
    expect(suggestions).toHaveLength(20);
    for (const s of suggestions) expect(s.confidence).toBe("high");
  });

  it("suggestion ids are stable fingerprints (dismissal-safe)", () => {
    const [a] = computeLinkSuggestions({ ...base, waiting: [waiting({ id: "w-1" })] });
    const [b] = computeLinkSuggestions({ ...base, waiting: [waiting({ id: "w-1" })] });
    expect(a!.id).toBe(b!.id);
    expect(a!.id).toBe("waiting_item:w-1:ownerPersonId:p-carlos");
  });
});
