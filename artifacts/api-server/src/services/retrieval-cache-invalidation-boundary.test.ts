import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not find ${start}..${end}`);
  return source.slice(from, to);
}

describe("retrieval corpus cache invalidation boundary", () => {
  it("invalidates after every single-note write", async () => {
    const notes = await readFile(new URL("./notes.ts", import.meta.url), "utf8");
    const create = between(
      notes,
      "export async function createNoteForUser",
      "export async function listNoteIdsForUser",
    );
    const update = between(
      notes,
      "export async function updateNoteForUser",
      "export async function deleteNoteForUser",
    );
    const remove = notes.slice(
      notes.indexOf("export async function deleteNoteForUser"),
    );

    expect(create).toContain("invalidateRetrievalCorpusCache(userId)");
    expect(update).toContain("invalidateRetrievalCorpusCache(userId)");
    expect(remove).toContain("invalidateRetrievalCorpusCache(userId)");
  });

  it("invalidates after each durable Google sync persistence tick", async () => {
    const connectors = await readFile(
      new URL("./connectors.ts", import.meta.url),
      "utf8",
    );
    const tick = between(
      connectors,
      "async function persistGoogleRecordsBatch",
      "export async function enqueueGoogleSyncForUser",
    );

    expect(tick).toContain("persistGoogleNormalizedRecordsBatch");
    expect(tick.match(/invalidateRetrievalCorpusCache\(userId\)/g)).toHaveLength(
      2,
    );
  });
});
