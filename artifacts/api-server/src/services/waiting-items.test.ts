import { describe, expect, it } from "vitest";
import {
  canTransitionWaitingStatus,
  computeNextFollowUpAt,
  defaultFollowUpAt,
  isWaitingDue,
  validateWaitingPatch,
  waitingDueReason,
  waitingFingerprint,
  WAITING_DEFAULT_FOLLOWUP_DAYS,
} from "./waiting-items";

describe("waitingFingerprint", () => {
  it("normalizes case, punctuation, and stopwords", () => {
    const a = waitingFingerprint("John Smith", "Send the as-built documents!");
    const b = waitingFingerprint("john  smith", "send as-built documents");
    expect(a).toBe(b);
  });

  it("differs across owners and deliverables", () => {
    const base = waitingFingerprint("Acme Permits", "Schedule inspection");
    expect(base).not.toBe(waitingFingerprint("Acme Permits", "City revision"));
    expect(base).not.toBe(waitingFingerprint("Bob", "Schedule inspection"));
  });

  it("keeps meaningful words and drops filler", () => {
    const fp = waitingFingerprint("The City Office", "Please handle the city revision for me");
    expect(fp).toContain("city");
    expect(fp).toContain("office");
    expect(fp).toContain("handle");
    expect(fp).toContain("revision");
    expect(fp).not.toMatch(/\bthe\b/);
  });
});

describe("canTransitionWaitingStatus", () => {
  it("allows open → snoozed/completed/dismissed", () => {
    expect(canTransitionWaitingStatus("open", "snoozed")).toBe(true);
    expect(canTransitionWaitingStatus("open", "completed")).toBe(true);
    expect(canTransitionWaitingStatus("open", "dismissed")).toBe(true);
  });

  it("terminal states can only reopen", () => {
    expect(canTransitionWaitingStatus("completed", "open")).toBe(true);
    expect(canTransitionWaitingStatus("dismissed", "open")).toBe(true);
    expect(canTransitionWaitingStatus("completed", "snoozed")).toBe(false);
    expect(canTransitionWaitingStatus("dismissed", "completed")).toBe(false);
  });
});

describe("defaultFollowUpAt", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("uses a certain expected date", () => {
    const expected = new Date("2026-08-05T12:00:00Z");
    const result = defaultFollowUpAt({
      promisedAt: new Date("2026-07-20T12:00:00Z"),
      expectedAt: expected,
      dateConfidence: "certain",
      now,
    });
    expect(result.at.getTime()).toBe(expected.getTime());
    expect(result.uncertain).toBe(false);
  });

  it("falls back to promised + 3d flagged uncertain when no certain date", () => {
    const promised = new Date("2026-07-20T12:00:00Z");
    const result = defaultFollowUpAt({
      promisedAt: promised,
      expectedAt: new Date("2026-08-05T12:00:00Z"),
      dateConfidence: "uncertain",
      now,
    });
    expect(result.at.getTime()).toBe(
      promised.getTime() + WAITING_DEFAULT_FOLLOWUP_DAYS * 86_400_000,
    );
    expect(result.uncertain).toBe(true);
  });

  it("never invents a deadline: no dates → now + 3d uncertain", () => {
    const result = defaultFollowUpAt({
      promisedAt: null,
      expectedAt: null,
      dateConfidence: "none",
      now,
    });
    expect(result.at.getTime()).toBe(
      now.getTime() + WAITING_DEFAULT_FOLLOWUP_DAYS * 86_400_000,
    );
    expect(result.uncertain).toBe(true);
  });
});

describe("waitingDueReason / isWaitingDue", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const base = {
    status: "open" as const,
    followUpAt: null,
    expectedAt: null,
    metadata: {},
  };

  it("needs_review wins", () => {
    expect(
      waitingDueReason({ ...base, metadata: { needsReview: true } }, now),
    ).toBe("needs_review");
  });

  it("follow-up due when followUpAt is in the past", () => {
    expect(
      waitingDueReason(
        { ...base, followUpAt: new Date("2026-07-27T12:00:00Z") },
        now,
      ),
    ).toBe("follow_up_due");
  });

  it("expected overdue when expectedAt passed without a follow-up date", () => {
    expect(
      waitingDueReason(
        { ...base, expectedAt: new Date("2026-07-25T12:00:00Z") },
        now,
      ),
    ).toBe("expected_overdue");
  });

  it("not due when dates are in the future", () => {
    expect(
      isWaitingDue(
        {
          ...base,
          followUpAt: new Date("2026-07-30T12:00:00Z"),
          expectedAt: new Date("2026-08-01T12:00:00Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("snoozed/completed items are never due", () => {
    for (const status of ["snoozed", "completed", "dismissed"] as const) {
      expect(
        isWaitingDue(
          { ...base, status, followUpAt: new Date("2026-07-01T12:00:00Z") },
          now,
        ),
      ).toBe(false);
    }
  });
});

describe("validateWaitingPatch", () => {
  it("trims strings and parses dates", () => {
    const out = validateWaitingPatch({
      ownerName: "  Acme Permits  ",
      expectedAt: "2026-08-15",
    });
    expect(out.ownerName).toBe("Acme Permits");
    expect(out.expectedAt?.toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("rejects empty ownerName / deliverable", () => {
    expect(() => validateWaitingPatch({ ownerName: "   " })).toThrow();
    expect(() => validateWaitingPatch({ deliverable: "" })).toThrow();
  });

  it("rejects invalid dates and bad confidence", () => {
    expect(() => validateWaitingPatch({ expectedAt: "not-a-date" })).toThrow();
    expect(() =>
      validateWaitingPatch({ dateConfidence: "maybe" as never }),
    ).toThrow();
  });

  it("allows clearing nullable fields", () => {
    const out = validateWaitingPatch({ ownerOrg: "", expectedAt: null });
    expect(out.ownerOrg).toBeNull();
    expect(out.expectedAt).toBeNull();
  });
});

describe("computeNextFollowUpAt", () => {
  it("advances by the requested days (default 3)", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(computeNextFollowUpAt(now).getTime()).toBe(now.getTime() + 3 * 86_400_000);
    expect(computeNextFollowUpAt(now, 7).getTime()).toBe(now.getTime() + 7 * 86_400_000);
  });

  it("clamps to 1..30 days", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(computeNextFollowUpAt(now, 0).getTime()).toBe(now.getTime() + 1 * 86_400_000);
    expect(computeNextFollowUpAt(now, 99).getTime()).toBe(now.getTime() + 30 * 86_400_000);
  });
});
