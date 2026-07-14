import { describe, expect, it } from "vitest";
import { buildNotesTsQuery } from "./notes";

describe("buildNotesTsQuery", () => {
  it("builds prefix AND queries from sanitized terms", () => {
    expect(buildNotesTsQuery(["costa", "rica"])).toBe("costa:* & rica:*");
  });

  it("rejects unsafe tokens", () => {
    expect(buildNotesTsQuery(["ok", "bad;drop"])).toBe("ok:*");
    expect(buildNotesTsQuery([])).toBeNull();
  });
});
