import { describe, expect, it } from "vitest";
import type { WaitingItem } from "@workspace/db/schema";
import {
  computeRevisedDates,
  decideOutcomeApplication,
  matchWaitingItemForReply,
  normalizeSubjectForMatch,
} from "./waiting-outcomes";

function item(overrides: Partial<WaitingItem>): WaitingItem {
  return {
    id: "wait-1",
    userId: "u-1",
    ownerPersonId: null,
    ownerName: "Carlos the Permit Vendor",
    ownerOrg: null,
    deliverable: "As-built documents",
    promisedAt: new Date("2026-07-20T12:00:00Z"),
    expectedAt: null,
    dateConfidence: "none",
    status: "open",
    followUpAt: null,
    snoozedUntil: null,
    completedAt: null,
    dismissedAt: null,
    lastOutcome: null,
    lastReplySourceRecordId: null,
    confidence: 0.8,
    fingerprint: "carlos permit vendor|as-built documents",
    threadId: null,
    sourceEntityType: "source_record",
    sourceEntityId: "sr-1",
    metadata: {},
    createdAt: new Date("2026-07-20T12:00:00Z"),
    updatedAt: new Date("2026-07-20T12:00:00Z"),
    ...overrides,
  } as WaitingItem;
}

describe("normalizeSubjectForMatch", () => {
  it("strips reply markers and punctuation", () => {
    expect(normalizeSubjectForMatch("Re: Fwd: As-Built Docs!")).toBe("as built docs");
  });
});

describe("matchWaitingItemForReply precedence", () => {
  const items = [
    item({ id: "wait-sender", threadId: null, metadata: { ownerEmail: "carlos@acme.com" } }),
    item({ id: "wait-thread", threadId: "thread-9", metadata: { ownerEmail: "other@acme.com" } }),
  ];

  it("threadId wins over sender", () => {
    const match = matchWaitingItemForReply(items, {
      threadId: "thread-9",
      senderEmail: "carlos@acme.com",
      subject: "Unrelated",
    });
    expect(match?.item.id).toBe("wait-thread");
    expect(match?.matchType).toBe("thread");
  });

  it("falls back to sender email when no thread matches", () => {
    const match = matchWaitingItemForReply(items, {
      threadId: "thread-zzz",
      senderEmail: "carlos@acme.com",
      subject: "Unrelated",
    });
    expect(match?.item.id).toBe("wait-sender");
    expect(match?.matchType).toBe("sender");
  });

  it("falls back to subject overlap", () => {
    const match = matchWaitingItemForReply(
      [item({ id: "wait-subj", deliverable: "As-built documents" })],
      { threadId: null, senderEmail: null, subject: "Re: As-built documents update" },
    );
    expect(match?.item.id).toBe("wait-subj");
    expect(match?.matchType).toBe("subject");
  });

  it("returns null when nothing matches", () => {
    expect(
      matchWaitingItemForReply(items, {
        threadId: null,
        senderEmail: "stranger@else.com",
        subject: "Happy hour Friday?",
      }),
    ).toBeNull();
  });
});

describe("decideOutcomeApplication (outcome → state matrix)", () => {
  it("completed needs high confidence", () => {
    expect(decideOutcomeApplication("completed", 0.9)).toBe("complete");
    expect(decideOutcomeApplication("completed", 0.6)).toBe("review");
  });

  it("revised applies at moderate confidence", () => {
    expect(decideOutcomeApplication("revised_delayed", 0.7)).toBe("revise");
    expect(decideOutcomeApplication("revised_delayed", 0.4)).toBe("review");
  });

  it("still_waiting is a low-risk note", () => {
    expect(decideOutcomeApplication("still_waiting", 0.6)).toBe("note");
    expect(decideOutcomeApplication("still_waiting", 0.3)).toBe("review");
  });

  it("unclear always goes to review", () => {
    expect(decideOutcomeApplication("unclear", 0.95)).toBe("review");
  });
});

describe("computeRevisedDates", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("a new explicit date becomes expected + follow-up, marked certain", () => {
    const out = computeRevisedDates({
      revisedExpectedAt: "2026-08-15",
      currentExpectedAt: new Date("2026-08-01T12:00:00Z"),
      promisedAt: new Date("2026-07-20T12:00:00Z"),
      dateConfidence: "certain",
      now,
    });
    expect(out.expectedAt?.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(out.followUpAt?.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(out.dateConfidence).toBe("certain");
  });

  it("without a new date, follow-up defaults to promised + 3d (never invented)", () => {
    const promised = new Date("2026-07-20T12:00:00Z");
    const out = computeRevisedDates({
      revisedExpectedAt: null,
      currentExpectedAt: null,
      promisedAt: promised,
      dateConfidence: "none",
      now,
    });
    expect(out.expectedAt).toBeNull();
    expect(out.followUpAt?.getTime()).toBe(promised.getTime() + 3 * 86_400_000);
    expect(out.dateConfidence).toBe("none");
  });
});
