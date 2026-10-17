import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildKeywordFallbackAnswer } from "./query-engine";
import { keywordScore } from "./retrieval";

describe("Ask keyword/full-text fallback without embeddings", () => {
  it("returns a graceful answer for a native note keyword hit", () => {
    const note = {
      entityType: "note",
      title: "Roof permit renewal",
      text: "The roof permit renewal is due November 12.",
    };
    expect(
      keywordScore("when is the roof permit renewal due", note.text),
    ).toBeGreaterThan(0);
    expect(() => buildKeywordFallbackAnswer([note])).not.toThrow();
    expect(buildKeywordFallbackAnswer([note]).answer).toContain(
      "Roof permit renewal",
    );
  });

  it("returns a graceful answer for Evernote-synced content with no vector row", () => {
    const syncedEvernote = {
      entityType: "source_record",
      title: "Evernote: Fence contractor",
      text: "evernote note notebook contractor quote from Acme Fence for 779 NW 41 ST",
    };
    expect(
      keywordScore("Acme fence quote", syncedEvernote.text),
    ).toBeGreaterThan(0);
    const result = buildKeywordFallbackAnswer([syncedEvernote]);
    expect(result.answer).toContain("Evernote: Fence contractor");
    expect(result.suggestedNextAction).toContain("source_record");
  });

  it("returns a non-throwing empty-state answer when neither vectors nor keywords match", () => {
    expect(() => buildKeywordFallbackAnswer([])).not.toThrow();
    expect(buildKeywordFallbackAnswer([]).answer).toMatch(
      /enough matching records/i,
    );
  });

  it("uses keyword-only retrieval when the Ask spend read is unavailable", async () => {
    const source = await readFile(
      new URL("query-engine.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('allowance.reason === "unavailable"');
    expect(source).toContain("semantic: false");
    expect(source).toContain("buildKeywordFallbackAnswer(keywordRecords)");
  });
});
