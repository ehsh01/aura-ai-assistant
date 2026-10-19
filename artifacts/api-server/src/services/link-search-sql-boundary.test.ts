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
      "export async function searchNoteHostnameFallbackForUser",
    );
    const fallbackSearch = between(
      notes,
      "export async function searchNoteHostnameFallbackForUser",
      "function vinHeuristicMatch",
    );
    const sourceSearches = between(
      retrieval,
      "export async function searchEvernoteSourceRecordsForUser",
      "/**\n * Shared free note retrieval",
    );

    expect(noteSearch).not.toContain("~*");
    expect(noteSearch).not.toMatch(/\s~\s/);
    expect(noteSearch).not.toContain("hostnameFallbackRegex");
    expect(noteSearch).toContain("set local jit = off");
    expect(noteSearch).toContain("left(${notes.searchDocument}, 20000)");
    expect(sourceSearches).not.toContain("~*");
    expect(sourceSearches).not.toMatch(/\s~\s/);
    expect(sourceSearches.match(/set local jit = off/g)).toHaveLength(2);
    expect(sourceSearches).toContain(
      "left(${sourceRecords.searchDocument}, 20000)",
    );
    expect(sourceSearches).toContain(
      "left(coalesce(ea.extracted_text, ''), 20000)",
    );
    expect(fallbackSearch.match(/~\*/g)).toHaveLength(1);
    expect(fallbackSearch).not.toContain(".orderBy(");
    expect(fallbackSearch).toContain("set local statement_timeout = '400ms'");
    expect(fallbackSearch).toContain("set local jit = off");
    expect(fallbackSearch).toContain(
      "Math.min(Math.max(Math.trunc(limit), 1), 3)",
    );
  });

  it("keeps the recent source corpus narrow", async () => {
    const retrieval = await readFile(
      new URL("./retrieval.ts", import.meta.url),
      "utf8",
    );
    const sourceCorpus = between(
      retrieval,
      "async function loadSourceRecordsBalanced",
      "function sourceRecordSearchTerms",
    );

    expect(sourceCorpus).not.toContain(
      "metadata: sourceRecords.recordMetadata",
    );
    expect(sourceCorpus).not.toContain("recordText}, 4000");
    expect(sourceCorpus).toContain("recordText}, 1500");
    expect(sourceCorpus).toContain(".limit(options.gmailPerMailbox)");
    expect(sourceCorpus).toContain("jsonb_build_object");
    expect(retrieval).toContain("(s.recordText ?? \"\").slice(0, 800)");
  });
});
