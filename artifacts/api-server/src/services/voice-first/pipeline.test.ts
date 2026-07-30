/**
 * Golden vertical slice for Voice First:
 * "Remind me tomorrow morning to call John about the MRI and connect it to the Smith project."
 *
 * Time and timezone are frozen and every provider is faked, so the resolved
 * reminder time and entity links are deterministic and cost nothing to run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanResult } from "../action-orchestrator";

const mocks = vi.hoisted(() => ({
  planActionsForText: vi.fn(),
  writeAuditLog: vi.fn(),
  getBriefingPrefsForUser: vi.fn(),
  listPeopleForUser: vi.fn(),
  listProjectsForUser: vi.fn(),
  listPersonNameAliases: vi.fn(),
}));

vi.mock("../action-orchestrator", () => ({ planActionsForText: mocks.planActionsForText }));
vi.mock("../audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("../notification-settings", () => ({
  getBriefingPrefsForUser: mocks.getBriefingPrefsForUser,
}));
vi.mock("../query-utils", () => ({ recallTimezone: () => "America/New_York" }));
vi.mock("../people", () => ({ listPeopleForUser: mocks.listPeopleForUser }));
vi.mock("../projects", () => ({ listProjectsForUser: mocks.listProjectsForUser }));
vi.mock("../user-corrections", () => ({
  listPersonNameAliases: mocks.listPersonNameAliases,
}));

import { receiveVoiceCapture } from "./pipeline";

const UTTERANCE =
  "Remind me tomorrow morning to call John about the MRI and connect it to the Smith project.";

/** Wednesday 2026-07-29 14:00 in New York. "Tomorrow" is therefore the 30th. */
const NOW = new Date("2026-07-29T18:00:00.000Z");

function planFixture(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    mode: "review",
    routing: {
      route: "capture",
      source: "model",
      degraded: false,
      primaryIntent: "reminder",
      secondaryIntents: [],
      confidence: 0.9,
      requiresConfirmation: true,
      reason: "test",
    },
    answer: null,
    rawCaptureId: "cap-1",
    actions: [
      {
        id: "act-1",
        type: "create_reminder",
        label: "Reminder",
        draft: {
          title: "Call John about the MRI",
          content: UTTERANCE,
          dueAt: null,
          priority: "medium",
          tags: [],
          domain: null,
          kind: "follow_up",
        },
        confidence: 0.9,
        reason: "Detected a reminder.",
      },
    ],
    mentions: { personName: "John", projectName: "Smith project" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.planActionsForText.mockResolvedValue(planFixture());
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.getBriefingPrefsForUser.mockResolvedValue({ timezone: "America/New_York" });
  mocks.listPeopleForUser.mockResolvedValue([{ id: "p-john", displayName: "John Carter" }]);
  mocks.listProjectsForUser.mockResolvedValue([{ id: "prj-smith", name: "Smith" }]);
  mocks.listPersonNameAliases.mockResolvedValue(new Map());
});

async function run() {
  return receiveVoiceCapture({
    userId: "u-1",
    text: UTTERANCE,
    source: "voice_server_stt",
    clientTimestamp: NOW.toISOString(),
  });
}

describe("receiveVoiceCapture — reminder vertical slice", () => {
  it("resolves 'tomorrow morning' to 9am in the user's timezone", async () => {
    const result = await run();
    const dueAt = result.actions[0]!.draft.dueAt!;
    // 09:00 EDT is 13:00 UTC.
    expect(new Date(dueAt).toISOString()).toBe("2026-07-30T13:00:00.000Z");
  });

  it("links the reminder to the only John and the Smith project", async () => {
    const result = await run();
    expect(result.actions[0]!.draft.personId).toBe("p-john");
    expect(result.actions[0]!.draft.projectId).toBe("prj-smith");
    expect(result.links.person?.status).toBe("resolved");
    expect(result.links.project?.status).toBe("resolved");
  });

  it("explains what it linked so the user can verify before confirming", async () => {
    const result = await run();
    expect(result.actions[0]!.reason).toContain("John Carter");
    expect(result.actions[0]!.reason).toContain("Smith");
  });

  it("refuses to link when two people match, and asks instead", async () => {
    mocks.listPeopleForUser.mockResolvedValue([
      { id: "p-carter", displayName: "John Carter" },
      { id: "p-smith", displayName: "John Smith" },
    ]);
    const result = await run();
    expect(result.links.person?.status).toBe("ambiguous");
    expect(result.actions[0]!.draft.personId).toBeNull();
    expect(result.links.clarification).toContain("John Carter");
    // The project was unambiguous, so it still links.
    expect(result.actions[0]!.draft.projectId).toBe("prj-smith");
  });

  it("leaves an unknown person unlinked rather than inventing one", async () => {
    mocks.listPeopleForUser.mockResolvedValue([]);
    const result = await run();
    expect(result.links.person?.status).toBe("unmatched");
    expect(result.actions[0]!.draft.personId).toBeNull();
  });

  it("never overwrites a date the user actually stated", async () => {
    const plan = planFixture();
    plan.actions[0]!.draft.dueAt = "2026-08-15T10:00:00.000Z";
    mocks.planActionsForText.mockResolvedValue(plan);
    const result = await run();
    expect(result.actions[0]!.draft.dueAt).toBe("2026-08-15T10:00:00.000Z");
  });

  it("keeps the transcript out of the audit log", async () => {
    await run();
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.action).toBe("voice_capture_planned");
    expect(JSON.stringify(entry)).not.toContain("MRI");
    expect(entry.metadata.textLength).toBe(UTTERANCE.length);
  });

  it("records how each mention resolved for observability", async () => {
    await run();
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry.metadata.personStatus).toBe("resolved");
    expect(entry.metadata.projectStatus).toBe("resolved");
  });

  it("rejects empty input before doing any work", async () => {
    await expect(
      receiveVoiceCapture({ userId: "u-1", text: "   ", source: "ask" }),
    ).rejects.toThrow(/required/i);
    expect(mocks.planActionsForText).not.toHaveBeenCalled();
  });

  it("does not attach links to a question-route answer", async () => {
    mocks.planActionsForText.mockResolvedValue(
      planFixture({ mode: "answer", actions: [], mentions: undefined }),
    );
    const result = await run();
    expect(result.links.person).toBeNull();
    expect(result.links.project).toBeNull();
  });
});
