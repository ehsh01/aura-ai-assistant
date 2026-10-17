import { describe, expect, it } from "vitest";
import { notesForList } from "./notes-search";
import type { RecallNote } from "./recall-context";

function note(
  id: string,
  title: string,
  notebookId: string | null,
  tags: string[],
): RecallNote {
  return {
    id,
    title,
    content: "",
    preview: "",
    tags,
    date: "Today",
    pinned: false,
    notebookId,
    projectId: null,
    contentFormat: "plain",
    attachmentCount: 0,
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  };
}

describe("Notes search result selection", () => {
  const loaded = [note("loaded", "Loaded page", "home", ["Personal"])];
  const server = [note("older", "Oil change", "garage", ["Vehicles"])];

  it("uses full-library server results for a non-empty query", () => {
    expect(
      notesForList({
        loadedNotes: loaded,
        serverResults: server,
        query: "oil change",
        notebook: "all",
        tag: "All",
      }).map((entry) => entry.id),
    ).toEqual(["older"]);
  });

  it("keeps empty-query filtering local and applies notebook and tag filters", () => {
    expect(
      notesForList({
        loadedNotes: [...loaded, ...server],
        serverResults: null,
        query: "",
        notebook: "garage",
        tag: "Vehicles",
      }).map((entry) => entry.id),
    ).toEqual(["older"]);
  });
});
