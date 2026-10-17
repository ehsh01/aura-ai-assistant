import { describe, expect, it } from "vitest";
import { parseItemSearchFilters } from "./items";

describe("parseItemSearchFilters", () => {
  it("accepts keyword, type, tag, date, source, notebook, and trash filters", () => {
    const filters = parseItemSearchFilters({
      q: "  permit renewal  ",
      type: "link",
      tag: "research",
      dateFrom: "2026-01-01",
      dateTo: "2026-10-17",
      source: "evernote",
      notebook: "House",
      trash: "true",
      limit: "75",
    });

    expect(filters).toMatchObject({
      q: "permit renewal",
      type: "link",
      tag: "research",
      source: "evernote",
      notebook: "House",
      trash: true,
      limit: 75,
    });
    expect(filters.dateFrom?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(filters.dateTo?.toISOString()).toBe("2026-10-17T23:59:59.999Z");
  });

  it("drops unsupported values and caps expensive requests", () => {
    expect(
      parseItemSearchFilters({
        type: "video",
        source: "drop table",
        dateFrom: "yesterday",
        limit: "9999",
      }),
    ).toMatchObject({
      type: null,
      source: null,
      dateFrom: null,
      limit: 200,
      trash: false,
    });
  });
});
