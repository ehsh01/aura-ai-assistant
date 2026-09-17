import { afterEach, describe, expect, it } from "vitest";
import {
  evernoteEmbeddingDailyLimit,
  evernoteEmbeddingSyncLimit,
  sourceRecordContentHashUnchanged,
} from "./connectors";
import { isEvernoteAskEnabled } from "./retrieval";

afterEach(() => {
  delete process.env.RECALL_BACKGROUND_AI_ENABLED;
  delete process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED;
  delete process.env.EVERNOTE_EMBEDDING_MAX_PER_SYNC;
  delete process.env.EVERNOTE_EMBEDDING_DAILY_CAP;
  delete process.env.RECALL_EVERNOTE_ASK_ENABLED;
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

  it("caps total Evernote embedding reservations per UTC day", () => {
    expect(evernoteEmbeddingDailyLimit()).toBe(100);
    process.env.EVERNOTE_EMBEDDING_DAILY_CAP = "5000";
    expect(evernoteEmbeddingDailyLimit()).toBe(1000);
  });

  it("can exclude Evernote from Ask independently", () => {
    expect(isEvernoteAskEnabled()).toBe(true);
    process.env.RECALL_EVERNOTE_ASK_ENABLED = "false";
    expect(isEvernoteAskEnabled()).toBe(false);
  });
});
