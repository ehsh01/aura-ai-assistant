import { describe, expect, it } from "vitest";
import {
  captureDueDatePromotion,
  hasDateCues,
  localDeadlineSkipReason,
  mapExtractedDeadline,
} from "./attention-extract";
import type { ExtractDeadlineItem } from "./ai";

const NOW = new Date("2026-07-28T15:00:00Z");

function extracted(overrides: Partial<ExtractDeadlineItem> = {}): ExtractDeadlineItem {
  return {
    hasCommitment: true,
    title: "Permit inspection",
    dueAt: "2026-08-04",
    kind: "deadline",
    personName: "Carlos",
    evidenceText: "inspection is scheduled for August 4",
    timeKnown: false,
    timeZone: null,
    dateConfidence: "certain",
    confidence: 0.9,
    ...overrides,
  };
}

describe("mapExtractedDeadline", () => {
  it("maps certain high-confidence dates", () => {
    const mapped = mapExtractedDeadline(extracted(), NOW);
    expect(mapped).not.toBeNull();
    expect(mapped!.dateConfidence).toBe("certain");
    expect(mapped!.dueAt.toISOString().startsWith("2026-08-04")).toBe(true);
  });

  it("keeps uncertain dates at a lower confidence bar", () => {
    const mapped = mapExtractedDeadline(
      extracted({ dateConfidence: "uncertain", confidence: 0.55, dueAt: "2026-08-31" }),
      NOW,
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.dateConfidence).toBe("uncertain");
  });

  it("drops uncertain dates below their confidence bar", () => {
    expect(
      mapExtractedDeadline(
        extracted({ dateConfidence: "uncertain", confidence: 0.45 }),
        NOW,
      ),
    ).toBeNull();
  });

  it("drops certain-tagged dates below the higher bar", () => {
    expect(
      mapExtractedDeadline(extracted({ dateConfidence: "certain", confidence: 0.6 }), NOW),
    ).toBeNull();
  });

  it("never maps items without a commitment or date", () => {
    expect(mapExtractedDeadline(extracted({ hasCommitment: false }), NOW)).toBeNull();
    expect(mapExtractedDeadline(extracted({ dueAt: null }), NOW)).toBeNull();
  });

  it("drops dates already in the past (never invents deadlines)", () => {
    expect(mapExtractedDeadline(extracted({ dueAt: "2026-07-01" }), NOW)).toBeNull();
  });

  it("preserves explicit time and timezone", () => {
    const mapped = mapExtractedDeadline(
      extracted({
        dueAt: "2026-08-04T14:00:00Z",
        timeKnown: true,
        timeZone: "America/New_York",
      }),
      NOW,
    );
    expect(mapped!.timeKnown).toBe(true);
    expect(mapped!.timeZone).toBe("America/New_York");
  });
});

describe("captureDueDatePromotion", () => {
  it("promotes a high-confidence suggested due date as certain", () => {
    const promo = captureDueDatePromotion(
      { suggestedDueDate: "2026-08-10", confidence: 0.9 },
      NOW,
    );
    expect(promo).not.toBeNull();
    expect(promo!.dateConfidence).toBe("certain");
    expect(promo!.dueAt.toISOString().startsWith("2026-08-10")).toBe(true);
  });

  it("marks mid-confidence suggested dates as uncertain", () => {
    const promo = captureDueDatePromotion(
      { suggestedDueDate: "2026-08-10", confidence: 0.6 },
      NOW,
    );
    expect(promo!.dateConfidence).toBe("uncertain");
  });

  it("ignores missing, invalid, or past dates", () => {
    expect(captureDueDatePromotion({ suggestedDueDate: null, confidence: 0.9 }, NOW)).toBeNull();
    expect(
      captureDueDatePromotion({ suggestedDueDate: "garbage", confidence: 0.9 }, NOW),
    ).toBeNull();
    expect(
      captureDueDatePromotion({ suggestedDueDate: "2026-06-01", confidence: 0.9 }, NOW),
    ).toBeNull();
  });
});

describe("hasDateCues", () => {
  it("matches deadline language", () => {
    expect(hasDateCues("Remind me about the permit deadline")).toBe(true);
    expect(hasDateCues("Inspection scheduled for next week")).toBe(true);
    expect(hasDateCues("court hearing on 09/14")).toBe(true);
    expect(hasDateCues("passport expires soon")).toBe(true);
  });

  it("does not match plain prose", () => {
    expect(hasDateCues("The weather was nice and we had lunch together")).toBe(false);
    expect(hasDateCues(null)).toBe(false);
    expect(hasDateCues("")).toBe(false);
  });
});

describe("localDeadlineSkipReason", () => {
  it("skips newsletters and automated senders without a model call", () => {
    expect(
      localDeadlineSkipReason(
        { senderEmail: "newsletter@e.iheart.com" },
        "Daily Digest",
        "Your weekly roundup",
      ),
    ).toBe("automated");
  });

  it("skips cue-less mail and marks it so the next sync does not reconsider it", () => {
    expect(
      localDeadlineSkipReason(
        { senderEmail: "friend@gmail.com" },
        "Lunch plans",
        "Want to grab coffee sometime?",
      ),
    ).toBe("no_date_cues");
  });

  it("lets messages with real date cues through to the model", () => {
    expect(
      localDeadlineSkipReason(
        { senderEmail: "vendor@city.gov" },
        "Inspection",
        "The permit inspection is scheduled for next week on Tuesday.",
      ),
    ).toBeNull();
  });
});
