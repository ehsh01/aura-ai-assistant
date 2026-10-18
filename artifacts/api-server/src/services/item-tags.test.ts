import { describe, expect, it } from "vitest";
import { evernoteDisplayTags, heuristicItemTags } from "./item-tags";

describe("heuristicItemTags", () => {
  it("derives domain, file, Evernote, notebook, and date tags without AI", () => {
    expect(
      heuristicItemTags({
        url: "https://www.Example.com/story",
        mimeType: "image/PNG",
        evernoteTags: ["Home", "Receipts"],
        notebook: "House Projects",
        date: new Date("2026-10-17T12:00:00Z"),
      }),
    ).toEqual([
      "example.com",
      "domain:example.com",
      "type:image",
      "format:png",
      "home",
      "receipts",
      "notebook:house projects",
      "year:2026",
      "date:2026-10",
    ]);
  });

  it("deduplicates and ignores malformed optional URLs", () => {
    expect(
      heuristicItemTags({
        url: "not a url",
        evernoteTags: ["Ideas", " ideas "],
        date: new Date("2025-01-01T00:00:00Z"),
      }),
    ).toEqual(["ideas", "year:2025", "date:2025-01"]);
  });

  it("hides generated notebook and year facets from Evernote display tags", () => {
    const before = [
      "real tag",
      "notebook:cf240195-dcdb-486a-8ab5-example",
      "year:2014",
      "year:2026",
    ];
    const after = evernoteDisplayTags(before);
    expect({
      notebookFacetNodesBefore: before.filter((tag) =>
        tag.startsWith("notebook:"),
      ).length,
      notebookFacetNodesAfter: after.filter((tag) =>
        tag.startsWith("notebook:"),
      ).length,
      yearFacetNodesBefore: before.filter((tag) => tag.startsWith("year:"))
        .length,
      yearFacetNodesAfter: after.filter((tag) => tag.startsWith("year:"))
        .length,
    }).toEqual({
      notebookFacetNodesBefore: 1,
      notebookFacetNodesAfter: 0,
      yearFacetNodesBefore: 2,
      yearFacetNodesAfter: 0,
    });
    expect(after).toEqual(["real tag"]);
  });
});
