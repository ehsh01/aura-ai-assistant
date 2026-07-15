import { describe, expect, it } from "vitest";
import { buildNotesTsQuery } from "./notes";

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
});
