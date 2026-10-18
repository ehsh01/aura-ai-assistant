import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start}..${end}`);
  return source.slice(from, to);
}

describe("link search SQL boundary", () => {
  it("keeps regex out of note ordering and both source-record searches", async () => {
    const [notes, retrieval] = await Promise.all([
      readFile(new URL("./notes.ts", import.meta.url), "utf8"),
      readFile(new URL("./retrieval.ts", import.meta.url), "utf8"),
    ]);
    const noteSearch = between(
      notes,
      "export async function searchNoteRecordsForUser",
      "function vinHeuristicMatch",
    );
    const sourceSearches = between(
      retrieval,
      "export async function searchEvernoteSourceRecordsForUser",
      "/**\n * Shared free note retrieval",
    );

    expect(noteSearch).not.toContain("~*");
    expect(noteSearch).not.toMatch(/\s~\s/);
    expect(sourceSearches).not.toContain("~*");
    expect(sourceSearches).not.toMatch(/\s~\s/);
    expect(sourceSearches).not.toContain("hostnameIlikePatterns");
  });
});
