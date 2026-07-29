import { describe, expect, it } from "vitest";
import type { AttentionItemDto } from "./attention";
import type { WaitingItemDto } from "./waiting-items";
import type { RecallTaskDto } from "./tasks";
import type { RecallCaptureItemDto } from "./capture-items";
import {
  buildEveningCheckin,
  buildMorningBriefing,
  decideBriefingSend,
  findFocusWindow,
  inQuietHours,
  scoreTaskForBriefing,
} from "./briefing";
import { BRIEFING_INTENT, EVENING_INTENT } from "./query-utils";

const NOW = new Date("2026-07-28T12:00:00Z"); // 12:00 UTC, a Tuesday
const TODAY = "2026-07-28";
const TOMORROW = "2026-07-29";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    ownerPersonId: null,
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
    requesterPersonId: null,
    requesterPersonName: null,
    createdAt: "2026-07-27T09:00:00Z",
    updatedAt: "2026-07-27T09:00:00Z",
    ...partial,
  };
}

function capture(
  partial: Partial<RecallCaptureItemDto> & Pick<RecallCaptureItemDto, "id">,
): RecallCaptureItemDto {
  return {
    rawCaptureId: null,
    rawText: "raw",
    cleanedTitle: "A captured thought",
    suggestedType: "task",
    suggestedPriority: "medium",
    suggestedDueDate: null,
    suggestedProject: null,
    suggestedTags: [],
    suggestedActions: [],
    suggestedPersonName: null,
    status: "pending",
    projectId: null,
    notebookId: null,
    confidence: 0.9,
    confidenceLabel: "high",
    sourceType: "quick_capture",
    sourceUrl: null,
    suggestedLinks: [],
    snoozedUntil: null,
    autoAccepted: false,
    attachmentCount: 0,
    createdAt: `${TODAY}T08:00:00Z`,
    updatedAt: `${TODAY}T08:00:00Z`,
    ...partial,
  };
}

const emptyInput = {
  date: TODAY,
  now: NOW,
  attention: [] as AttentionItemDto[],
  waiting: [] as WaitingItemDto[],
  tasks: [] as RecallTaskDto[],
  captures: [] as RecallCaptureItemDto[],
  timezone: "UTC",
};

// ---------------------------------------------------------------------------
// buildMorningBriefing
// ---------------------------------------------------------------------------

describe("buildMorningBriefing", () => {
  it("prioritizes overdue deadlines first and keeps kinds diverse within the cap", () => {
    const result = buildMorningBriefing({
      ...emptyInput,
      attention: [
        attention({ id: "a-old", title: "Permit filing", dueAt: "2026-07-26T09:00:00Z" }),
        attention({ id: "a-newer", title: "Pay invoice", dueAt: "2026-07-27T09:00:00Z" }),
        attention({ id: "a-week", title: "Renew insurance", dueAt: "2026-07-31T09:00:00Z" }),
        attention({ id: "a-week2", title: "City hearing", dueAt: "2026-08-01T09:00:00Z" }),
      ],
      waiting: [waiting({ id: "w-1" }), waiting({ id: "w-2", deliverable: "Signed contract" })],
      tasks: [task({ id: "t-1", title: "Call the bank", priority: "high" })],
      captures: [capture({ id: "c-1" })],
    });

    expect(result.actions.length).toBeLessThanOrEqual(5);
    // attentionUrgencyScore ranks recently-overdue above long-overdue (stale items decay).
    expect(result.actions[0]!.id).toBe("a-newer");
    expect(result.actions[0]!.reason).toMatch(/overdue/i);
    const kinds = result.actions.map((a) => a.kind);
    expect(kinds).toContain("waiting");
    expect(kinds).toContain("task");
    // Diversity cap: at most 2 deadlines in the first pass even with 4 candidates.
    expect(kinds.filter((k) => k === "deadline").length).toBe(2);
  });

  it("explains waiting items in plain language with days", () => {
    const result = buildMorningBriefing({
      ...emptyInput,
      waiting: [waiting({ id: "w-1", promisedAt: "2026-07-23T10:00:00Z" })],
    });
    const action = result.actions.find((a) => a.kind === "waiting");
    expect(action?.reason).toBe("You asked Carlos 5 days ago");
  });

  it("never invents a briefing on empty input", () => {
    const result = buildMorningBriefing(emptyInput);
    expect(result.summary).toBe("Nothing urgent on your plate today.");
    expect(result.actions).toEqual([]);
    expect(result.calendarToday).toEqual([]);
    expect(result.focusWindow).toBeNull(); // no calendar data
  });

  it("counts meetings, deadlines, and due follow-ups in the summary", () => {
    const result = buildMorningBriefing({
      ...emptyInput,
      attention: [
        attention({
          id: "m-1",
          title: "Site walkthrough",
          kind: "appointment",
          timeKnown: true,
          dueAt: "2026-07-28T14:00:00Z",
        }),
        attention({ id: "d-1", title: "Filing", dueAt: "2026-07-30T09:00:00Z" }),
        attention({ id: "d-2", title: "Permit", dueAt: "2026-08-02T09:00:00Z" }),
      ],
      waiting: [waiting({ id: "w-1" })],
    });
    expect(result.summary).toBe(
      "You have 1 meeting today, 2 deadlines this week and 1 follow-up due.",
    );
  });

  it("excludes review-queue ids so candidates never double-surface", () => {
    const result = buildMorningBriefing({
      ...emptyInput,
      attention: [attention({ id: "a-1", title: "Uncertain date", dueAt: "2026-07-29T09:00:00Z" })],
      excludeIds: new Set(["a-1"]),
    });
    expect(result.actions.find((a) => a.id === "a-1")).toBeUndefined();
    expect(result.summary).toBe("Nothing urgent on your plate today.");
  });

  it("labels appointment times only when the source stated a time", () => {
    const result = buildMorningBriefing({
      ...emptyInput,
      attention: [
        attention({
          id: "m-timed",
          title: "Dentist",
          kind: "appointment",
          timeKnown: true,
          dueAt: "2026-07-28T13:30:00Z",
        }),
        attention({
          id: "m-allday",
          title: "Conference",
          kind: "appointment",
          timeKnown: false,
          dueAt: "2026-07-28T00:00:00Z",
        }),
      ],
    });
    const timed = result.calendarToday.find((c) => c.id === "m-timed");
    const allDay = result.calendarToday.find((c) => c.id === "m-allday");
    expect(timed?.startLabel).toBe("1:30 PM");
    expect(allDay?.startLabel).toBeNull();
  });

  it("flags stale finance data instead of showing numbers", () => {
    const result = buildMorningBriefing({ ...emptyInput, financeNeedsSync: true });
    expect(result.dataNotes.join(" ")).toMatch(/hasn't synced recently/i);
  });
});

describe("scoreTaskForBriefing", () => {
  it("scores due high-priority tasks highest, ignores completed and stale", () => {
    expect(scoreTaskForBriefing(task({ id: "x", title: "Done", completed: true }), TODAY)).toBe(-1);
    expect(
      scoreTaskForBriefing(
        task({ id: "y", title: "Old undated", updatedAt: "2026-06-01T00:00:00Z", createdAt: "2026-06-01T00:00:00Z" }),
        TODAY,
      ),
    ).toBe(-1);
    const hot = scoreTaskForBriefing(
      task({ id: "z", title: "Pay permit fee", priority: "high", time: TODAY }),
      TODAY,
    );
    expect(hot).toBeGreaterThanOrEqual(85); // 40 high + 45 due + 20 urgent keyword
  });
});

// ---------------------------------------------------------------------------
// findFocusWindow
// ---------------------------------------------------------------------------

describe("findFocusWindow", () => {
  it("returns the first usable gap between meetings", () => {
    const gap = findFocusWindow({
      busy: [
        { startMin: 9 * 60, endMin: 10 * 60 },
        { startMin: 12 * 60, endMin: 13 * 60 },
      ],
      nowMin: 7 * 60 + 30,
    });
    expect(gap).toEqual({ startMin: 8 * 60, endMin: 9 * 60 });
  });

  it("clips a gap that started in the past to start from now (+buffer)", () => {
    const gap = findFocusWindow({
      busy: [{ startMin: 9 * 60, endMin: 10 * 60 }],
      nowMin: 10 * 60 + 30,
    });
    expect(gap).toEqual({ startMin: 10 * 60 + 45, endMin: 18 * 60 });
  });

  it("ignores gaps shorter than 45 minutes", () => {
    const gap = findFocusWindow({
      busy: [{ startMin: 8 * 60, endMin: 17 * 60 + 45 }],
      nowMin: 8 * 60,
    });
    expect(gap).toBeNull();
  });

  it("returns null when the day is full", () => {
    const gap = findFocusWindow({
      busy: [{ startMin: 8 * 60, endMin: 18 * 60 }],
      nowMin: 9 * 60,
    });
    expect(gap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildEveningCheckin
// ---------------------------------------------------------------------------

describe("buildEveningCheckin", () => {
  it("buckets completed, unfinished, tomorrow, and waiting items", () => {
    const result = buildEveningCheckin({
      date: TODAY,
      tomorrowDate: TOMORROW,
      now: NOW,
      tasks: [
        task({ id: "t-done", title: "Signed papers", completed: true, updatedAt: `${TODAY}T15:00:00Z` }),
        task({ id: "t-old", title: "Old completion", completed: true, updatedAt: "2026-07-27T15:00:00Z" }),
        task({ id: "t-high", title: "Urgent call", priority: "high" }),
        task({ id: "t-low", title: "Someday maybe", priority: "low" }),
      ],
      attentionOpen: [
        attention({ id: "a-overdue", title: "Permit filing", dueAt: "2026-07-27T09:00:00Z" }),
        attention({ id: "a-tomorrow", title: "Inspection", kind: "appointment", dueAt: `${TOMORROW}T13:00:00Z` }),
        attention({ id: "a-later", title: "Far away", dueAt: "2026-08-15T09:00:00Z" }),
      ],
      attentionTerminal: [
        attention({
          id: "a-done",
          title: "City revision sent",
          status: "completed",
          completedAt: `${TODAY}T11:00:00Z`,
          dueAt: "2026-07-28T09:00:00Z",
        }),
      ],
      waiting: [
        waiting({ id: "w-due", followUpAt: `${TOMORROW}T09:00:00Z` }),
        waiting({ id: "w-done", status: "completed", completedAt: `${TODAY}T10:00:00Z`, followUpAt: null }),
        waiting({ id: "w-later", followUpAt: "2026-08-10T09:00:00Z" }),
      ],
    });

    expect(result.completedToday.map((i) => i.id).sort()).toEqual(["a-done", "t-done", "w-done"]);
    expect(result.approximateTaskCompletions).toBe(true);
    expect(result.unfinished.map((i) => i.id).sort()).toEqual(["a-overdue", "t-high"]);
    expect(result.tomorrow.map((i) => i.id)).toEqual(["a-tomorrow"]);
    expect(result.waitingDue.map((i) => i.id)).toEqual(["w-due"]);
  });

  it("reports a clean evening when nothing is tracked", () => {
    const result = buildEveningCheckin({
      date: TODAY,
      tomorrowDate: TOMORROW,
      now: NOW,
      tasks: [],
      attentionOpen: [],
      attentionTerminal: [],
      waiting: [],
    });
    expect(result.completedToday).toEqual([]);
    expect(result.unfinished).toEqual([]);
    expect(result.tomorrow).toEqual([]);
    expect(result.waitingDue).toEqual([]);
    expect(result.approximateTaskCompletions).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideBriefingSend
// ---------------------------------------------------------------------------

const PREFS = {
  enabled: true,
  time: "07:30",
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
  lastSentOn: null as string | null,
  timezone: "UTC",
};

describe("decideBriefingSend", () => {
  it("sends once local time passes the configured time", () => {
    const d = decideBriefingSend(PREFS, new Date("2026-07-28T08:00:00Z"));
    expect(d).toEqual({ send: true, localDate: TODAY });
  });

  it("does not send before the configured time", () => {
    expect(decideBriefingSend(PREFS, new Date("2026-07-28T07:00:00Z")).send).toBe(false);
  });

  it("never sends twice on the same local date (idempotent)", () => {
    const d = decideBriefingSend(
      { ...PREFS, lastSentOn: TODAY },
      new Date("2026-07-28T09:00:00Z"),
    );
    expect(d.send).toBe(false);
  });

  it("does not send when disabled", () => {
    expect(
      decideBriefingSend({ ...PREFS, enabled: false }, new Date("2026-07-28T09:00:00Z")).send,
    ).toBe(false);
  });

  it("defers a configured time inside quiet hours until quiet hours end", () => {
    // 07:30 target is inside 21:00–08:00 quiet; at 07:45 quiet still blocks.
    expect(decideBriefingSend(PREFS, new Date("2026-07-28T07:45:00Z")).send).toBe(false);
    // At 08:00 quiet ends and the deferred send fires.
    expect(decideBriefingSend(PREFS, new Date("2026-07-28T08:00:00Z")).send).toBe(true);
  });

  it("evaluates the schedule in the user's timezone", () => {
    // New York (EDT, UTC-4): 07:30 target falls inside 21:00–08:00 quiet,
    // so the send fires when quiet ends at 08:00 local = 12:00 UTC.
    const ny = { ...PREFS, timezone: "America/New_York" };
    expect(decideBriefingSend(ny, new Date("2026-07-28T11:29:00Z")).send).toBe(false);
    const at = decideBriefingSend(ny, new Date("2026-07-28T12:00:00Z"));
    expect(at).toEqual({ send: true, localDate: TODAY });
  });

  it("quiet windows wrap midnight", () => {
    expect(inQuietHours(23 * 60, "21:00", "08:00")).toBe(true);
    expect(inQuietHours(7 * 60, "21:00", "08:00")).toBe(true);
    expect(inQuietHours(12 * 60, "21:00", "08:00")).toBe(false);
    expect(inQuietHours(20 * 60, "21:00", "08:00")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ask intents
// ---------------------------------------------------------------------------

describe("briefing Ask intents", () => {
  it("routes day-planning questions to the briefing handler", () => {
    expect(BRIEFING_INTENT.test("What should I focus on today?")).toBe(true);
    expect(BRIEFING_INTENT.test("Give me my morning briefing")).toBe(true);
    expect(BRIEFING_INTENT.test("What's on today?")).toBe(true);
    expect(BRIEFING_INTENT.test("What do I have today?")).toBe(true);
  });

  it("does not hijack generic focus or planning questions", () => {
    expect(BRIEFING_INTENT.test("How do I focus better at work?")).toBe(false);
    expect(BRIEFING_INTENT.test("Help me plan the kitchen remodel")).toBe(false);
  });

  it("routes evening and tomorrow-prep questions to the check-in handler", () => {
    expect(EVENING_INTENT.test("What did I not finish today?")).toBe(true);
    expect(EVENING_INTENT.test("What should I prepare for tomorrow?")).toBe(true);
    expect(EVENING_INTENT.test("What's on for tomorrow?")).toBe(true);
    expect(EVENING_INTENT.test("Help me wrap up my day")).toBe(true);
  });

  it("does not hijack unrelated tomorrow mentions", () => {
    expect(EVENING_INTENT.test("Will it rain tomorrow?")).toBe(false);
  });
});
