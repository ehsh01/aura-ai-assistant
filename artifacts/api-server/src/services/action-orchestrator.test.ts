import { describe, expect, it } from "vitest";
import { draftProposedActions, defaultReminderDue } from "./action-orchestrator";
import type { ClassifyIntentResult, IntentKind } from "../prompts/classifyIntent.v1";
import type { CaptureClassificationItem } from "./ai";

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
  it("returns tomorrow at 9:00 AM (never in the past)", () => {
    const now = new Date("2026-07-19T15:30:00");
    const due = defaultReminderDue(now);
    expect(due.getTime()).toBeGreaterThan(now.getTime());
    expect(due.getHours()).toBe(9);
    expect(due.getDate()).toBe(20);
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
