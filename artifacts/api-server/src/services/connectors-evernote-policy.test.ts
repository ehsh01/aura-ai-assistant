import { afterEach, describe, expect, it } from "vitest";
import {
  evernoteEmbeddingDailyLimit,
  evernoteEmbeddingSyncLimit,
  sourceRecordContentHashUnchanged,
} from "./connectors";
import { isEvernoteAskEnabled } from "./retrieval";

afterEach(() => {
  delete process.env.RECALL_BACKGROUND_AI_ENABLED;
  delete process.env.RECALL_EMBEDDING_WARM_ENABLED;
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

  it("permanently disables sync-time embeddings", () => {
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
    process.env.EVERNOTE_EMBEDDING_MAX_PER_SYNC = "500";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
  });

  it("supports connector and global embedding kill-switches", () => {
    process.env.RECALL_BACKGROUND_AI_ENABLED = "true";
    process.env.RECALL_EMBEDDING_WARM_ENABLED = "true";
    process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED = "true";
    process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED = "false";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
    process.env.RECALL_EVERNOTE_EMBEDDINGS_ENABLED = "true";
    process.env.RECALL_BACKGROUND_AI_ENABLED = "false";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
    process.env.RECALL_BACKGROUND_AI_ENABLED = "true";
    process.env.RECALL_EMBEDDING_WARM_ENABLED = "false";
    expect(evernoteEmbeddingSyncLimit()).toBe(0);
  });

  it("permanently disables daily embedding reservations", () => {
    expect(evernoteEmbeddingDailyLimit()).toBe(0);
    process.env.EVERNOTE_EMBEDDING_DAILY_CAP = "5000";
    expect(evernoteEmbeddingDailyLimit()).toBe(0);
  });

  it("can exclude Evernote from Ask independently", () => {
    expect(isEvernoteAskEnabled()).toBe(true);
    process.env.RECALL_EVERNOTE_ASK_ENABLED = "false";
    expect(isEvernoteAskEnabled()).toBe(false);
  });
});
