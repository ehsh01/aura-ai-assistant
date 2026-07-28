import { describe, expect, it } from "vitest";
import {
  hasWaitingCues,
  isInboundGmailRecord,
  mapCommitmentDates,
} from "./waiting-extract";

describe("hasWaitingCues (pre-filter)", () => {
  it("matches promise cues", () => {
    expect(hasWaitingCues("I'll send the report tomorrow")).toBe(true);
    expect(hasWaitingCues("We can schedule the inspection next week")).toBe(true);
    expect(hasWaitingCues("The documents will be ready by Friday")).toBe(true);
    expect(hasWaitingCues("I will send you the revised plans within 2 days")).toBe(true);
    expect(hasWaitingCues("Let me take care of the city submission")).toBe(true);
  });

  it("ignores plain newsletters and receipts", () => {
    expect(hasWaitingCues("Your order #12345 has shipped. Track your package.")).toBe(
      false,
    );
    expect(hasWaitingCues("This week in Miami: events you can't miss")).toBe(false);
    expect(hasWaitingCues("Receipt for your payment of $42.00")).toBe(false);
  });
});

describe("isInboundGmailRecord", () => {
  it("requires a sender and excludes the mailbox owner", () => {
    expect(
      isInboundGmailRecord({ senderEmail: "vendor@acme.com", mailbox: "me@x.com" }),
    ).toBe(true);
    expect(
      isInboundGmailRecord({ senderEmail: "me@x.com", mailbox: "me@x.com" }),
    ).toBe(false);
    expect(isInboundGmailRecord({ mailbox: "me@x.com" })).toBe(false);
  });

  it("treats missing mailbox as inbound when a sender exists", () => {
    expect(isInboundGmailRecord({ senderEmail: "vendor@acme.com" })).toBe(true);
  });
});

describe("mapCommitmentDates", () => {
  const emailDate = new Date("2026-07-25T15:00:00Z");

  it("maps certain expected dates", () => {
    const out = mapCommitmentDates(
      { promisedAt: "2026-07-25", expectedAt: "2026-08-01", dateConfidence: "certain" },
      emailDate,
    );
    expect(out.expectedAt?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(out.dateConfidence).toBe("certain");
  });

  it("uncertain timing never yields an expectedAt", () => {
    const out = mapCommitmentDates(
      { promisedAt: "2026-07-25", expectedAt: null, dateConfidence: "uncertain" },
      emailDate,
    );
    expect(out.expectedAt).toBeNull();
    expect(out.dateConfidence).toBe("none");
  });

  it("dateConfidence none discards even a parsed date (never invent deadlines)", () => {
    const out = mapCommitmentDates(
      { promisedAt: "2026-07-25", expectedAt: "2026-08-01", dateConfidence: "none" },
      emailDate,
    );
    expect(out.expectedAt).toBeNull();
    expect(out.dateConfidence).toBe("none");
  });

  it("unparseable dates are dropped, not guessed", () => {
    const out = mapCommitmentDates(
      { promisedAt: "next Friday-ish", expectedAt: "soon", dateConfidence: "certain" },
      emailDate,
    );
    expect(out.expectedAt).toBeNull();
    expect(out.dateConfidence).toBe("none");
  });

  it("promisedAt falls back to the factual email date", () => {
    const out = mapCommitmentDates(
      { promisedAt: null, expectedAt: null, dateConfidence: "none" },
      emailDate,
    );
    expect(out.promisedAt?.getTime()).toBe(emailDate.getTime());
  });
});
