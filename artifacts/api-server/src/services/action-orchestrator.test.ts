import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClassifyIntentResult, IntentKind } from "../prompts/classifyIntent.v1";
import type { CaptureClassificationItem } from "./ai";

const mocks = vi.hoisted(() => ({
  getCaptureForUser: vi.fn(),
  updateCaptureStatusForUser: vi.fn(),
  createEvidenceForUser: vi.fn(),
  upsertAttentionItemForUser: vi.fn(),
  createTaskForUser: vi.fn(),
  writeAuditLog: vi.fn(),
  listPeopleForUser: vi.fn(),
  listProjectsForUser: vi.fn(),
}));

// confirmProposedAction touches several domain services; mock at the module
// boundary so these tests never require a real DB connection.
vi.mock("./captures", () => ({
  createCaptureForUser: vi.fn(),
  getCaptureForUser: mocks.getCaptureForUser,
  updateCaptureStatusForUser: mocks.updateCaptureStatusForUser,
}));
vi.mock("./evidence", () => ({ createEvidenceForUser: mocks.createEvidenceForUser }));
vi.mock("./attention", () => ({
  upsertAttentionItemForUser: mocks.upsertAttentionItemForUser,
  dueAtFromDateString: (raw: string) => {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  },
}));
vi.mock("./tasks", () => ({ createTaskForUser: mocks.createTaskForUser }));
vi.mock("./life-memory", () => ({ createMemoryForUser: vi.fn() }));
vi.mock("./notes", () => ({ createNoteForUser: vi.fn() }));
vi.mock("./capture-pipeline", () => ({
  queueCaptureExtraction: vi.fn(),
  ingestCaptureForUser: vi.fn(),
}));
vi.mock("./audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("./people", () => ({ listPeopleForUser: mocks.listPeopleForUser }));
vi.mock("./projects", () => ({ listProjectsForUser: mocks.listProjectsForUser }));

import {
  draftProposedActions,
  defaultReminderDue,
  confirmProposedAction,
} from "./action-orchestrator";

function intent(overrides: Partial<ClassifyIntentResult> = {}): ClassifyIntentResult {
  return {
    primaryIntent: "capture",
    secondaryIntents: [],
    confidence: 0.8,
    requiresConfirmation: false,
    containsQuestion: false,
    containsAction: false,
    containsDurableFact: false,
    containsDeadline: false,
    containsAttachment: false,
    reason: "test",
    ...overrides,
  };
}

function classification(
  overrides: Partial<CaptureClassificationItem> = {},
): CaptureClassificationItem {
  return {
    cleanedTitle: "Call the plumber",
    suggestedType: "task",
    suggestedPriority: "medium",
    suggestedDueDate: null,
    suggestedProject: null,
    suggestedTags: [],
    suggestedActions: [],
    ...overrides,
  };
}

function primaryTypes(intentKind: IntentKind, suggestedType: CaptureClassificationItem["suggestedType"]) {
  return draftProposedActions(
    "some text",
    intent({ primaryIntent: intentKind }),
    classification({ suggestedType }),
  ).map((a) => a.type);
}

describe("draftProposedActions — intent → action type", () => {
  it("maps task intent to create_task", () => {
    expect(primaryTypes("task", "task")).toEqual(["create_task"]);
  });

  it("maps reminder intent to create_reminder with follow_up kind", () => {
    const [action] = draftProposedActions(
      "remind me tonight",
      intent({ primaryIntent: "reminder", containsDeadline: true }),
      classification({ suggestedType: "reminder", suggestedDueDate: "2026-07-20" }),
    );
    expect(action?.type).toBe("create_reminder");
    expect(action?.draft.kind).toBe("follow_up");
    expect(action?.draft.dueAt).toBe("2026-07-20");
  });

  it("maps memory intent to save_memory", () => {
    expect(primaryTypes("memory", "note")).toEqual(["save_memory"]);
  });

  it("maps note intent to create_note", () => {
    expect(primaryTypes("note", "note")).toEqual(["create_note"]);
  });

  it("safe-defaults finance_record to the inbox (no create API)", () => {
    expect(primaryTypes("finance_record", "reference")).toEqual(["send_to_inbox"]);
  });

  it("safe-defaults person_update and command to the inbox", () => {
    expect(primaryTypes("person_update", "note")).toEqual(["send_to_inbox"]);
    expect(primaryTypes("command", "note")).toEqual(["send_to_inbox"]);
  });
});

describe("draftProposedActions — generic capture falls back to extraction type", () => {
  it("uses suggestedType=task → create_task for a generic capture", () => {
    expect(primaryTypes("capture", "task")).toEqual(["create_task"]);
  });

  it("uses suggestedType=reference → create_note for a generic capture", () => {
    expect(primaryTypes("capture", "reference")).toEqual(["create_note"]);
  });

  it("prefers memory when a generic capture contains a durable fact", () => {
    const types = draftProposedActions(
      "my passport number is X",
      intent({ primaryIntent: "capture", containsDurableFact: true }),
      classification({ suggestedType: "note" }),
    ).map((a) => a.type);
    expect(types[0]).toBe("save_memory");
  });
});

describe("draftProposedActions — multi-intent fan-out", () => {
  it("adds a second save_memory card when a task also states a durable fact", () => {
    const actions = draftProposedActions(
      "call the DMV; my license number is D123",
      intent({ primaryIntent: "task", containsDurableFact: true }),
      classification({ suggestedType: "task" }),
    );
    expect(actions.map((a) => a.type)).toEqual(["create_task", "save_memory"]);
    expect(actions[1]?.draft.kind).toBeNull();
  });

  it("does not duplicate a memory card when the primary is already save_memory", () => {
    const actions = draftProposedActions(
      "remember my passport expires in June",
      intent({ primaryIntent: "memory", containsDurableFact: true }),
      classification({ suggestedType: "note" }),
    );
    expect(actions.map((a) => a.type)).toEqual(["save_memory"]);
  });
});

describe("defaultReminderDue — dateless reminders still get a real time", () => {
  it("returns exactly one hour from now", () => {
    const now = new Date("2026-07-19T15:30:00");
    const due = defaultReminderDue(now);
    expect(due.getTime() - now.getTime()).toBe(60 * 60_000);
  });
});

describe("draftProposedActions — draft field mapping", () => {
  it("carries title, priority, tags, and content into the draft", () => {
    const [action] = draftProposedActions(
      "  Buy new tires this week  ",
      intent({ primaryIntent: "task", confidence: 0.77 }),
      classification({
        cleanedTitle: "Buy new tires",
        suggestedType: "task",
        suggestedPriority: "urgent",
        suggestedTags: ["car", "errand"],
        suggestedDueDate: "2026-07-25",
      }),
    );
    expect(action?.draft.title).toBe("Buy new tires");
    expect(action?.draft.priority).toBe("urgent");
    expect(action?.draft.tags).toEqual(["car", "errand"]);
    expect(action?.draft.content).toBe("Buy new tires this week");
    expect(action?.draft.dueAt).toBe("2026-07-25");
    expect(action?.confidence).toBe(0.77);
  });

  it("falls back to the first line of text when there is no cleaned title", () => {
    const [action] = draftProposedActions(
      "First line here\nsecond line",
      intent({ primaryIntent: "note" }),
      classification({ cleanedTitle: "", suggestedType: "note" }),
    );
    expect(action?.draft.title).toBe("First line here");
  });
});

function draft(overrides: Partial<import("./action-orchestrator").ProposedActionDraft> = {}) {
  return {
    title: "Put oil in my car",
    content: "remind me to put oil in my car",
    dueAt: null,
    priority: "medium" as const,
    tags: [],
    domain: null,
    kind: null,
    ...overrides,
  };
}

describe("confirmProposedAction — capture status transition (regression)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.upsertAttentionItemForUser.mockResolvedValue({ id: "attn-1" });
    mocks.createTaskForUser.mockResolvedValue({ id: "task-1" });
  });

  it("does NOT throw when the raw capture is still 'pending' (the reported bug)", async () => {
    mocks.getCaptureForUser.mockResolvedValue({ id: "raw-1", processedStatus: "pending" });
    mocks.updateCaptureStatusForUser.mockResolvedValue({ id: "raw-1" });

    const result = await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft(),
      rawCaptureId: "raw-1",
    });

    expect(result.entityType).toBe("attention_item");
    // pending → processing → processed, never pending → processed directly.
    expect(mocks.updateCaptureStatusForUser).toHaveBeenNthCalledWith(1, "user-1", "raw-1", {
      processedStatus: "processing",
    });
    expect(mocks.updateCaptureStatusForUser).toHaveBeenNthCalledWith(2, "user-1", "raw-1", {
      processedStatus: "processed",
    });
  });

  it("applies the 1-hour default due date when the draft has no date", async () => {
    mocks.getCaptureForUser.mockResolvedValue({ id: "raw-1", processedStatus: "pending" });
    mocks.updateCaptureStatusForUser.mockResolvedValue({ id: "raw-1" });

    const before = Date.now();
    await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft({ dueAt: null }),
      rawCaptureId: "raw-1",
    });

    const call = mocks.upsertAttentionItemForUser.mock.calls[0]?.[1];
    expect(call.dueAt.getTime() - before).toBeGreaterThan(59 * 60_000);
    expect(call.dueAt.getTime() - before).toBeLessThan(61 * 60_000);
  });

  it("does not touch capture status when already 'processed' (idempotent)", async () => {
    mocks.getCaptureForUser.mockResolvedValue({ id: "raw-1", processedStatus: "processed" });

    await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft(),
      rawCaptureId: "raw-1",
    });

    expect(mocks.updateCaptureStatusForUser).not.toHaveBeenCalled();
  });

  it("never throws even if the capture status update itself fails", async () => {
    mocks.getCaptureForUser.mockResolvedValue({ id: "raw-1", processedStatus: "pending" });
    mocks.updateCaptureStatusForUser.mockRejectedValue(new Error("Cannot transition capture"));

    await expect(
      confirmProposedAction("user-1", {
        type: "create_task",
        draft: draft(),
        rawCaptureId: "raw-1",
      }),
    ).resolves.toMatchObject({ entityType: "task" });
  });
});

describe("confirmProposedAction — person/project links are user-scoped", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.upsertAttentionItemForUser.mockResolvedValue({ id: "attn-1" });
    mocks.createTaskForUser.mockResolvedValue({ id: "task-1" });
    mocks.getCaptureForUser.mockResolvedValue({ id: "raw-1", processedStatus: "processed" });
    mocks.listPeopleForUser.mockResolvedValue([{ id: "p-mine", displayName: "John Carter" }]);
    mocks.listProjectsForUser.mockResolvedValue([{ id: "prj-mine", name: "Smith" }]);
  });

  it("attaches links the user owns to a reminder", async () => {
    await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft({ personId: "p-mine", projectId: "prj-mine" }),
    });
    const call = mocks.upsertAttentionItemForUser.mock.calls[0]?.[1];
    expect(call.personId).toBe("p-mine");
    expect(call.projectId).toBe("prj-mine");
  });

  it("attaches links the user owns to a task", async () => {
    await confirmProposedAction("user-1", {
      type: "create_task",
      draft: draft({ personId: "p-mine", projectId: "prj-mine" }),
    });
    const call = mocks.createTaskForUser.mock.calls[0]?.[1];
    expect(call.requesterPersonId).toBe("p-mine");
    expect(call.projectId).toBe("prj-mine");
  });

  it("drops an id belonging to someone else instead of trusting the client", async () => {
    await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft({ personId: "p-someone-else", projectId: "prj-someone-else" }),
    });
    const call = mocks.upsertAttentionItemForUser.mock.calls[0]?.[1];
    expect(call.personId).toBeNull();
    expect(call.projectId).toBeNull();
  });

  it("still creates the item when a link is rejected", async () => {
    const result = await confirmProposedAction("user-1", {
      type: "create_reminder",
      draft: draft({ personId: "p-someone-else" }),
    });
    expect(result.entityType).toBe("attention_item");
  });

  it("skips the ownership lookup entirely when there are no links", async () => {
    await confirmProposedAction("user-1", { type: "create_reminder", draft: draft() });
    expect(mocks.listPeopleForUser).not.toHaveBeenCalled();
    expect(mocks.listProjectsForUser).not.toHaveBeenCalled();
  });
});
