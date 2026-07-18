import { describe, expect, it } from "vitest";
import {
  attentionUrgencyScore,
  dueAtFromDateString,
  resolveSnoozeUntil,
  type AttentionItemDto,
} from "./attention";

function baseItem(overrides: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return {
    id: "attn-1",
    title: "Court date",
    summary: null,
    dueAt: new Date("2026-03-12T12:00:00Z").toISOString(),
    kind: "deadline",
    status: "open",
    seenAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    completedAt: null,
    sourceEntityType: "source_record",
    sourceEntityId: "sr-1",
    evidenceText: "court date is March 12",
    personId: null,
    projectId: null,
    confidence: 0.9,
    href: "/ask",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("dueAtFromDateString", () => {
  it("parses YYYY-MM-DD", () => {
    const d = dueAtFromDateString("2026-03-12");
    expect(d).not.toBeNull();
    expect(d!.toISOString().startsWith("2026-03-12")).toBe(true);
  });

  it("parses ISO datetime", () => {
    const d = dueAtFromDateString("2026-03-12T15:30:00Z");
    expect(d?.toISOString()).toBe("2026-03-12T15:30:00.000Z");
  });

  it("returns null for garbage", () => {
    expect(dueAtFromDateString("not-a-date")).toBeNull();
  });
});

describe("resolveSnoozeUntil", () => {
  const due = new Date("2026-03-12T12:00:00Z");
  const now = new Date("2026-03-01T12:00:00Z");

  it("snoozes to 1 day before due", () => {
    const until = resolveSnoozeUntil(due, "1d_before", now);
    expect(until.getTime()).toBe(due.getTime() - 86_400_000);
  });

  it("snoozes to 7 days before due", () => {
    const until = resolveSnoozeUntil(due, "7d_before", now);
    expect(until.getTime()).toBe(due.getTime() - 7 * 86_400_000);
  });

  it("does not snooze into the past when due is soon", () => {
    const soon = new Date(now.getTime() + 2 * 3_600_000);
    const until = resolveSnoozeUntil(soon, "1d_before", now);
    expect(until.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

describe("attentionUrgencyScore", () => {
  it("ranks overdue above far-future", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const overdue = attentionUrgencyScore(
      baseItem({ dueAt: "2026-03-12T12:00:00.000Z" }),
      now,
    );
    const later = attentionUrgencyScore(
      baseItem({ dueAt: "2026-04-12T12:00:00.000Z" }),
      now,
    );
    expect(overdue).toBeGreaterThan(later);
  });

  it("boosts unseen open items", () => {
    const now = new Date("2026-03-11T12:00:00Z");
    const unseen = attentionUrgencyScore(baseItem({ status: "open", seenAt: null }), now);
    const seen = attentionUrgencyScore(
      baseItem({ status: "seen", seenAt: now.toISOString() }),
      now,
    );
    expect(unseen).toBeGreaterThan(seen);
  });
});
