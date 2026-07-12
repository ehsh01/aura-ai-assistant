import { describe, expect, it } from "vitest";
import {
  buildGmailPersonQuery,
  buildGmailSearchQuery,
  extractMailPersonName,
  rankLiveGmailHitsForPerson,
  type LiveGmailHit,
} from "./connectors";

describe("buildGmailSearchQuery", () => {
  it("builds broad from queries so business display names still match", () => {
    const q = buildGmailSearchQuery("Okay, look for emails from Nancy Bryant.");
    expect(q).toContain("from:(Nancy Bryant)");
    expect(q).toContain("from:Nancy");
    expect(q).toContain("from:Bryant");
    expect(q).toContain('"Nancy Bryant"');
    expect(buildGmailSearchQuery("emails from Sandra Hernandez")).toContain(
      "from:(Sandra Hernandez)",
    );
  });

  it("builds topic queries for about questions", () => {
    expect(buildGmailSearchQuery("emails about the permit")).toBe("the permit");
  });

  it("returns null for non-mail questions", () => {
    expect(buildGmailSearchQuery("How much did I spend?")).toBeNull();
    expect(buildGmailSearchQuery("how about nancy bryant")).toBeNull();
  });
});

describe("extractMailPersonName", () => {
  it("extracts names from from-phrases and follow-ups", () => {
    expect(extractMailPersonName("look for emails from Nancy Bryant.")).toBe(
      "Nancy Bryant",
    );
    expect(extractMailPersonName("how about nancy bryant")).toBe("nancy bryant");
  });
});

describe("buildGmailPersonQuery", () => {
  it("builds OR query across from tokens and phrase", () => {
    expect(buildGmailPersonQuery("Nancy Bryant")).toBe(
      '(from:(Nancy Bryant) OR from:Nancy OR from:Bryant OR "Nancy Bryant" OR (Nancy Bryant))',
    );
  });
});

describe("rankLiveGmailHitsForPerson", () => {
  it("prefers inbound Bryant Permit Service over user's own replies", () => {
    const hits: LiveGmailHit[] = [
      {
        mailbox: "reiinvestorsllc@gmail.com",
        title: "Re: 779 NW 41 ST",
        text: "Mailbox: reiinvestorsllc@gmail.com\nFrom: Ernesto Hernandez <reiinvestorsllc@gmail.com>\nsender_email: reiinvestorsllc@gmail.com",
        externalId: "gmail:sent",
        sourceUrl: null,
        sourceCreatedAt: "2026-04-23T19:53:02.000Z",
      },
      {
        mailbox: "reiinvestorsllc@gmail.com",
        title: "Re: 779 NW 41 ST",
        text: "Mailbox: reiinvestorsllc@gmail.com\nFrom: Bryant Permit Service <nancibry@yahoo.com>\nsender_name: Bryant Permit Service\nsender_email: nancibry@yahoo.com",
        externalId: "gmail:in",
        sourceUrl: null,
        sourceCreatedAt: "2026-04-23T19:43:51.000Z",
      },
    ];
    const ranked = rankLiveGmailHitsForPerson(hits, "Nancy Bryant");
    expect(ranked[0]?.externalId).toBe("gmail:in");
  });
});
