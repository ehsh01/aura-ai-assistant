import { describe, expect, it } from "vitest";
import {
  attentionDueReason,
  attentionUrgencyScore,
  dueAtFromDateString,
  groupDeadlines,
  resolveSnoozeUntil,
  validateAttentionPatch,
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
    taskId: null,
    organizationId: null,
    waitingItemId: null,
    dateConfidence: "certain",
    timeZone: null,
    timeKnown: false,
    confirmedAt: new Date("2026-03-01T00:00:00Z").toISOString(),
    confidence: 0.9,
    metadata: {},
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

// Local-time construction keeps day-boundary tests timezone-stable.
function localIso(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m - 1, d, h).toISOString();
}

describe("attentionDueReason", () => {
  const now = new Date(2026, 2, 15, 12, 0, 0); // Mar 15 2026, noon local

  it("labels overdue items in days", () => {
    const reason = attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 12) }), now);
    expect(reason.label).toBe("3 days overdue");
    expect(reason.overdue).toBe(true);
    expect(reason.highRisk).toBe(true);
  });

  it("labels a single overdue day", () => {
    const reason = attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 14) }), now);
    expect(reason.label).toBe("1 day overdue");
  });

  it("labels due-today and due-tomorrow", () => {
    expect(attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 15, 17) }), now).label).toBe(
      "Due today",
    );
    expect(attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 15, 9) }), now).label).toBe(
      "Due earlier today",
    );
    expect(attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 16) }), now).label).toBe(
      "Due tomorrow",
    );
  });

  it("labels upcoming week and later dates", () => {
    expect(attentionDueReason(baseItem({ dueAt: localIso(2026, 3, 19) }), now).label).toBe(
      "Due in 4 days",
    );
    expect(
      attentionDueReason(baseItem({ dueAt: localIso(2026, 4, 2) }), now).label,
    ).toMatch(/^Due Apr 2$/);
  });

  it("flags unconfirmed uncertain dates and asks for confirmation", () => {
    const reason = attentionDueReason(
      baseItem({ dateConfidence: "uncertain", confirmedAt: null, dueAt: localIso(2026, 3, 16) }),
      now,
    );
    expect(reason.unconfirmed).toBe(true);
    expect(reason.label).toBe("Due tomorrow · confirm date");
    // Due within 48h + unconfirmed = high risk.
    expect(reason.highRisk).toBe(true);
  });

  it("treats confirmed uncertain-extracted dates as confirmed", () => {
    const reason = attentionDueReason(
      baseItem({
        dateConfidence: "uncertain",
        confirmedAt: localIso(2026, 3, 14),
        dueAt: localIso(2026, 3, 16),
      }),
      now,
    );
    expect(reason.unconfirmed).toBe(false);
    expect(reason.highRisk).toBe(false);
  });
});

describe("validateAttentionPatch", () => {
  it("accepts a valid patch", () => {
    const result = validateAttentionPatch({
      title: "City revision deadline",
      dueAt: "2026-04-01",
      kind: "deadline",
      dateConfidence: "certain",
      timeZone: "America/New_York",
      personId: "person-1",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects empty titles and bad dates", () => {
    const result = validateAttentionPatch({ title: "   ", dueAt: "not-a-date" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("; ")).toMatch(/title/);
    expect(result.errors.join("; ")).toMatch(/dueAt/);
  });

  it("rejects unknown kind and dateConfidence", () => {
    const result = validateAttentionPatch({ kind: "party", dateConfidence: "maybe" });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});

describe("groupDeadlines", () => {
  const now = new Date(2026, 2, 15, 12, 0, 0); // Mar 15 2026, noon local

  it("groups overdue, today, this week, later", () => {
    const groups = groupDeadlines(
      [
        baseItem({ id: "a", dueAt: localIso(2026, 3, 10) }),
        baseItem({ id: "b", dueAt: localIso(2026, 3, 15, 18) }),
        baseItem({ id: "c", dueAt: localIso(2026, 3, 18) }),
        baseItem({ id: "d", dueAt: localIso(2026, 4, 5) }),
      ],
      now,
    );
    expect(groups.overdue.map((i) => i.id)).toEqual(["a"]);
    expect(groups.today.map((i) => i.id)).toEqual(["b"]);
    expect(groups.thisWeek.map((i) => i.id)).toEqual(["c"]);
    expect(groups.later.map((i) => i.id)).toEqual(["d"]);
  });

  it("pulls unconfirmed and snoozed items out of the date groups", () => {
    const groups = groupDeadlines(
      [
        baseItem({
          id: "u",
          dueAt: localIso(2026, 3, 10),
          dateConfidence: "uncertain",
          confirmedAt: null,
        }),
        baseItem({ id: "s", dueAt: localIso(2026, 3, 16), status: "snoozed" }),
      ],
      now,
    );
    expect(groups.unconfirmed.map((i) => i.id)).toEqual(["u"]);
    expect(groups.snoozed.map((i) => i.id)).toEqual(["s"]);
    expect(groups.overdue).toEqual([]);
    expect(groups.thisWeek).toEqual([]);
  });
});
