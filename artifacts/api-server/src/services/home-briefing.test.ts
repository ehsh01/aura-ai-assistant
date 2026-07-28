import { describe, expect, it } from "vitest";
import { buildReviewStrip, scoreCaptureUrgency } from "./home-briefing";
import type { RecallCaptureItemDto } from "./capture-items";
import type { WaitingItemDto } from "./waiting-items";
import type { AttentionItemDto } from "./attention";

const TODAY = "2026-07-28";

function capture(overrides: Partial<RecallCaptureItemDto> = {}): RecallCaptureItemDto {
  return {
    id: "ci-1",
    rawCaptureId: "cap-1",
    rawText: "picked up milk on the way home",
    cleanedTitle: "Picked up milk",
    suggestedType: "note",
    suggestedPriority: "medium",
    suggestedDueDate: null,
    suggestedProject: null,
    suggestedTags: [],
    suggestedActions: [],
    suggestedPersonName: null,
    status: "pending",
    projectId: null,
    notebookId: null,
    confidence: 0.5,
    confidenceLabel: "needs_review",
    sourceType: "manual",
    sourceUrl: null,
    suggestedLinks: [],
    snoozedUntil: null,
    autoAccepted: false,
    attachmentCount: 0,
    createdAt: "2026-07-28T10:00:00Z",
    updatedAt: "2026-07-28T10:00:00Z",
    ...overrides,
  };
}

describe("scoreCaptureUrgency — Today visibility gating", () => {
  it("excludes low-value pending captures (no universal base score)", () => {
    expect(scoreCaptureUrgency(capture(), TODAY)).toBe(-1);
    expect(scoreCaptureUrgency(capture({ suggestedPriority: "low" }), TODAY)).toBe(-1);
    expect(
      scoreCaptureUrgency(capture({ suggestedPriority: "medium", rawText: "nice photo" }), TODAY),
    ).toBe(-1);
  });

  it("excludes non-pending captures regardless of signals", () => {
    const urgent = { suggestedPriority: "urgent" as const, rawText: "urgent: call the city" };
    expect(scoreCaptureUrgency(capture({ ...urgent, status: "accepted" }), TODAY)).toBe(-1);
    expect(scoreCaptureUrgency(capture({ ...urgent, status: "dismissed" }), TODAY)).toBe(-1);
    expect(scoreCaptureUrgency(capture({ ...urgent, status: "snoozed" }), TODAY)).toBe(-1);
  });

  it("includes urgent/high priority captures", () => {
    expect(scoreCaptureUrgency(capture({ suggestedPriority: "urgent" }), TODAY)).toBe(60);
    expect(scoreCaptureUrgency(capture({ suggestedPriority: "high" }), TODAY)).toBe(40);
  });

  it("includes captures due today or in the past, not future ones", () => {
    expect(scoreCaptureUrgency(capture({ suggestedDueDate: TODAY }), TODAY)).toBe(45);
    expect(scoreCaptureUrgency(capture({ suggestedDueDate: "2026-07-01" }), TODAY)).toBe(45);
    expect(scoreCaptureUrgency(capture({ suggestedDueDate: "2026-08-15" }), TODAY)).toBe(-1);
  });

  it("includes captures with urgency keywords in title or text", () => {
    expect(
      scoreCaptureUrgency(capture({ cleanedTitle: "Call the permit office" }), TODAY),
    ).toBe(20);
    expect(
      scoreCaptureUrgency(capture({ rawText: "Inspection scheduled, need to prepare" }), TODAY),
    ).toBe(20);
  });

  it("stacks signals and ranks an urgent dated capture above a keyword-only one", () => {
    const stacked = scoreCaptureUrgency(
      capture({ suggestedPriority: "urgent", suggestedDueDate: TODAY }),
      TODAY,
    );
    const keywordOnly = scoreCaptureUrgency(capture({ rawText: "blocked on the ticket" }), TODAY);
    expect(stacked).toBe(105);
    expect(stacked).toBeGreaterThan(keywordOnly);
  });
});

// ---------------------------------------------------------------------------
// buildReviewStrip — the "needs your confirmation" roll-up
// ---------------------------------------------------------------------------

function waiting(overrides: Partial<WaitingItemDto> = {}): WaitingItemDto {
  return {
    id: "w-1",
    ownerPersonId: null,
    ownerName: "Carlos",
    ownerOrg: null,
    deliverable: "inspection confirmation",
    promisedAt: "2026-07-20",
    expectedAt: null,
    dateConfidence: "none",
    status: "candidate",
    followUpAt: null,
    snoozedUntil: null,
    completedAt: null,
    dismissedAt: null,
    lastOutcome: null,
    lastReplySourceRecordId: null,
    confidence: 0.5,
    threadId: null,
    sourceEntityType: "gmail_message",
    sourceEntityId: "msg-1",
    projectId: null,
    taskId: null,
    needsReview: false,
    candidateReason: "Possible follow-up — Aura is 50% confident",
    suggestedResolution: null,
    metadata: {},
    href: "/waiting/w-1",
    createdAt: "2026-07-26T10:00:00Z",
    updatedAt: "2026-07-26T10:00:00Z",
    ...overrides,
  };
}

function attention(overrides: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return {
    id: "a-1",
    title: "Permit revision due",
    summary: null,
    dueAt: "2026-07-30T14:00:00Z",
    kind: "deadline",
    status: "open",
    seenAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    completedAt: null,
    sourceEntityType: "gmail_message",
    sourceEntityId: "msg-2",
    evidenceText: null,
    personId: null,
    projectId: null,
    taskId: null,
    organizationId: null,
    waitingItemId: null,
    dateConfidence: "uncertain",
    timeZone: null,
    timeKnown: false,
    confirmedAt: null,
    confidence: 0.55,
    metadata: {},
    href: "/deadlines?item=a-1",
    createdAt: "2026-07-26T10:00:00Z",
    updatedAt: "2026-07-26T10:00:00Z",
    ...overrides,
  };
}

describe("buildReviewStrip — review surface roll-up", () => {
  it("returns an empty state when nothing needs review", () => {
    const result = buildReviewStrip({ waiting: [], attention: [], inbox: [] });
    expect(result).toEqual({
      waitingCandidates: 0,
      unconfirmedDeadlines: 0,
      inboxPending: 0,
      total: 0,
      items: [],
    });
  });

  it("excludes non-candidate waiting items, confirmed/certain deadlines, and non-pending inbox rows", () => {
    const result = buildReviewStrip({
      waiting: [
        waiting({ id: "w-open", status: "open" }),
        waiting({ id: "w-snoozed", status: "snoozed" }),
        waiting({ id: "w-done", status: "completed" }),
      ],
      attention: [
        attention({ id: "a-certain", dateConfidence: "certain" }),
        attention({ id: "a-confirmed", confirmedAt: "2026-07-27T09:00:00Z" }),
      ],
      inbox: [
        capture({ id: "ci-accepted", status: "accepted" }),
        capture({ id: "ci-dismissed", status: "dismissed" }),
        capture({ id: "ci-snoozed", status: "snoozed" }),
      ],
    });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("orders waiting candidates first, then deadlines by soonest due, then oldest pending inbox", () => {
    const result = buildReviewStrip({
      waiting: [
        waiting({ id: "w-newer", createdAt: "2026-07-27T10:00:00Z" }),
        waiting({ id: "w-older", createdAt: "2026-07-25T10:00:00Z" }),
      ],
      attention: [
        attention({ id: "a-later", dueAt: "2026-08-05T14:00:00Z" }),
        attention({ id: "a-sooner", dueAt: "2026-07-29T14:00:00Z" }),
      ],
      inbox: [
        capture({ id: "ci-newer", createdAt: "2026-07-28T10:00:00Z" }),
        capture({ id: "ci-older", createdAt: "2026-07-20T10:00:00Z" }),
      ],
      limit: 10,
    });
    expect(result.items.map((i) => i.id)).toEqual([
      "w-older",
      "w-newer",
      "a-sooner",
      "a-later",
      "ci-older",
      "ci-newer",
    ]);
    expect(result.items.map((i) => i.queue)).toEqual([
      "waiting",
      "waiting",
      "deadline",
      "deadline",
      "inbox",
      "inbox",
    ]);
  });

  it("caps items at 3 by default while counts stay full", () => {
    const result = buildReviewStrip({
      waiting: [waiting({ id: "w-1" }), waiting({ id: "w-2" })],
      attention: [attention({ id: "a-1" }), attention({ id: "a-2" })],
      inbox: [capture({ id: "ci-1" }), capture({ id: "ci-2" })],
    });
    expect(result.items).toHaveLength(3);
    expect(result.waitingCandidates).toBe(2);
    expect(result.unconfirmedDeadlines).toBe(2);
    expect(result.inboxPending).toBe(2);
    expect(result.total).toBe(6);
  });

  it("builds UI-ready titles, details, and hrefs", () => {
    const result = buildReviewStrip({
      waiting: [waiting({ id: "w-1", candidateReason: "Possible follow-up" })],
      attention: [attention({ id: "a-1", dueAt: "2026-07-30T14:00:00Z" })],
      inbox: [capture({ id: "ci-1", cleanedTitle: "Call the permit office" })],
    });
    const [w, d, c] = result.items;
    expect(w).toMatchObject({
      queue: "waiting",
      title: "inspection confirmation",
      detail: "Possible follow-up",
      href: "/waiting/w-1",
    });
    expect(d).toMatchObject({
      queue: "deadline",
      title: "Permit revision due",
      detail: "Confirm this date — due 2026-07-30",
      href: "/deadlines?item=a-1",
    });
    expect(c).toMatchObject({
      queue: "inbox",
      title: "Call the permit office",
      detail: "Review this capture",
      href: "/inbox?capture=ci-1",
    });
  });

  it("falls back to a generic detail when candidateReason is missing", () => {
    const result = buildReviewStrip({
      waiting: [waiting({ candidateReason: null, ownerName: "Priya" })],
      attention: [],
      inbox: [],
    });
    expect(result.items[0]?.detail).toBe(
      "Confirm to track this follow-up with Priya",
    );
  });
});
