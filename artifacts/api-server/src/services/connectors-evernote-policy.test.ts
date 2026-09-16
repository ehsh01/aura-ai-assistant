import { afterEach, describe, expect, it } from "vitest";
import {
  evernoteEmbeddingSyncLimit,
  sourceRecordContentHashUnchanged,
} from "./connectors";

afterEach(() => {
  delete process.env.RECALL_BACKGROUND_AI_ENABLED;
  delete process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED;
  delete process.env.EVERNOTE_EMBEDDING_MAX_PER_SYNC;
});

describe("Evernote sync cost policy", () => {
  it("skips records only when both content hashes match", () => {
    expect(
      sourceRecordContentHashUnchanged(
        { contentHash: "same" },
        { contentHash: "same" },
      ),
    ).toBe(true);
    expect(
      sourceRecordContentHashUnchanged(
        { contentHash: "old" },
        { contentHash: "new" },
      ),
    ).toBe(false);
    expect(sourceRecordContentHashUnchanged({}, {})).toBe(false);
  });

  it("defaults to a small cap and enforces the hard maximum", () => {
    expect(evernoteEmbeddingSyncLimit()).toBe(25);
    process.env.EVERNOTE_EMBEDDING_MAX_PER_SYNC = "500";
    expect(evernoteEmbeddingSyncLimit()).toBe(100);
  });

  it("supports connector and global embedding kill-switches", () => {
    process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED = "false";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
    delete process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED;
    process.env.RECALL_BACKGROUND_AI_ENABLED = "false";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
  });
});
