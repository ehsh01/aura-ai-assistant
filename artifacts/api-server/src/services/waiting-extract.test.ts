import { describe, expect, it } from "vitest";
import {
  AUTOMATED_SENDER_RE,
  candidateReasonForConfidence,
  hasOutboundRequestCues,
  hasWaitingCues,
  isAutomatedGmailRecord,
  isInboundGmailRecord,
  isOutboundGmailRecord,
  mapCommitmentDates,
  parseToField,
  perspectiveForRecord,
  waitingStatusForConfidence,
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

describe("isAutomatedGmailRecord (newsletter/marketing filter)", () => {
  it("flags automated sender addresses", () => {
    for (const sender of [
      "noreply@acme.com",
      "no-reply@acme.com",
      "donotreply@acme.com",
      "mailer-daemon@acme.com",
      "newsletters@e.iheart.com",
      "marketing@shop.com",
      "notifications@social.com",
      "receipts@store.com",
    ]) {
      expect(AUTOMATED_SENDER_RE.test(sender)).toBe(true);
      expect(isAutomatedGmailRecord({ senderEmail: sender })).toBe(true);
    }
  });

  it("flags bulk-mail body markers even from normal addresses", () => {
    const body = "Hi there, sale ends today! Click to unsubscribe from this list.";
    expect(isAutomatedGmailRecord({ senderEmail: "deals@shop.com" }, body)).toBe(true);
  });

  it("keeps real people", () => {
    expect(
      isAutomatedGmailRecord(
        { senderEmail: "carlos@acmepermits.com" },
        "I'll send the as-built documents by Friday.",
      ),
    ).toBe(false);
    expect(isAutomatedGmailRecord({ senderEmail: "maria.lopez@gmail.com" })).toBe(false);
  });
});

describe("hasOutboundRequestCues", () => {
  it("matches the owner's requests", () => {
    expect(hasOutboundRequestCues("Can you send the inspection confirmation?")).toBe(true);
    expect(hasOutboundRequestCues("Please review the attached plans and let me know")).toBe(true);
    expect(hasOutboundRequestCues("When will the permit be ready?")).toBe(true);
    expect(hasOutboundRequestCues("Any update on the city revision?")).toBe(true);
  });

  it("ignores plain statements and small talk", () => {
    expect(hasOutboundRequestCues("Thanks, received everything.")).toBe(false);
    expect(hasOutboundRequestCues("See you at the office party.")).toBe(false);
  });
});

describe("isOutboundGmailRecord / perspectiveForRecord", () => {
  it("detects messages the owner wrote", () => {
    const meta = { senderEmail: "me@x.com", mailbox: "me@x.com" };
    expect(isOutboundGmailRecord(meta)).toBe(true);
    expect(perspectiveForRecord(meta)).toBe("outbound");
    expect(perspectiveForRecord({ senderEmail: "them@x.com", mailbox: "me@x.com" })).toBe(
      "inbound",
    );
  });
});

describe("parseToField", () => {
  it("parses named and bare recipients", () => {
    expect(parseToField("From: Me <me@x.com>\nTo: Carlos <carlos@acme.com>")).toEqual({
      name: "Carlos",
      email: "carlos@acme.com",
    });
    expect(parseToField("To: carlos@acme.com, other@acme.com")).toEqual({
      name: "",
      email: "carlos@acme.com",
    });
    expect(parseToField("Subject: hello")).toEqual({ name: "", email: "" });
  });
});

describe("waitingStatusForConfidence (confidence/review model)", () => {
  it("opens only explicit commitments", () => {
    expect(waitingStatusForConfidence(0.9)).toBe("open");
    expect(waitingStatusForConfidence(0.7)).toBe("open");
  });

  it("queues plausible guesses for review", () => {
    expect(waitingStatusForConfidence(0.55)).toBe("candidate");
    expect(waitingStatusForConfidence(0.45)).toBe("candidate");
  });

  it("excludes low-confidence guesses entirely", () => {
    expect(waitingStatusForConfidence(0.44)).toBeNull();
    expect(waitingStatusForConfidence(0.1)).toBeNull();
  });

  it("manual extraction lowers the review floor, never the open bar", () => {
    expect(waitingStatusForConfidence(0.65, 0.4)).toBe("candidate");
    expect(waitingStatusForConfidence(0.42, 0.4)).toBe("candidate");
    expect(waitingStatusForConfidence(0.39, 0.4)).toBeNull();
  });

  it("explains why in plain language", () => {
    expect(candidateReasonForConfidence("inbound", 0.5)).toMatch(/possible commitment/i);
    expect(candidateReasonForConfidence("outbound", 0.5)).toMatch(/you asked/i);
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
