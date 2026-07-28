import { describe, expect, it } from "vitest";
import { scoreCaptureUrgency } from "./home-briefing";
import type { RecallCaptureItemDto } from "./capture-items";

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
