import { describe, expect, it } from "vitest";
import {
  buildNotesTsQuery,
  buildSplitTokenRegexes,
  shouldExpandUrlTokens,
} from "./notes";

describe("buildNotesTsQuery", () => {
  it("builds prefix AND queries for short term lists", () => {
    expect(buildNotesTsQuery(["costa", "rica"])).toBe("costa:* & rica:*");
    expect(buildNotesTsQuery(["vin", "porsche", "cayenne"])).toBe(
      "vin:* & porsche:* & cayenne:*",
    );
  });

  it("builds OR queries for longer conversational term lists", () => {
    expect(buildNotesTsQuery(["costa", "rica", "trip", "itinerary"])).toBe(
      "costa:* | rica:* | trip:* | itinerary:*",
    );
  });

  it("rejects unsafe tokens", () => {
    expect(buildNotesTsQuery(["ok", "bad;drop"])).toBe("ok:*");
    expect(buildNotesTsQuery([])).toBeNull();
  });

  it("expands hostname and hyphen tokens without matching ordinary substrings", () => {
    const [pattern] = buildSplitTokenRegexes(["psychiatry"]);
    const regex = new RegExp(pattern!, "i");
    expect(regex.test("psychiatry.med.miami.edu")).toBe(true);
    expect(regex.test("portal-psychiatry.health")).toBe(true);
    expect(regex.test("general psychiatry notes")).toBe(false);
    expect(shouldExpandUrlTokens("khaila school portal link")).toBe(true);
    expect(shouldExpandUrlTokens("ordinary note summary")).toBe(false);
  });
});
