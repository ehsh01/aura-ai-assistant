import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEmbeddingCacheForTests,
  cosineSimilarity,
  embedItemsCached,
  embeddingWarmWithinDailyCaps,
  getEmbeddingCacheMetrics,
  resetEmbeddingCacheMetricsForTests,
  warmEntityEmbedding,
} from "./embedding-cache";
import { aiService } from "./ai";

const savedWarmEnabled = process.env.RECALL_EMBEDDING_WARM_ENABLED;
const savedCountLimit = process.env.RECALL_EMBEDDING_WARM_DAILY_LIMIT;
const savedTokenLimit = process.env.RECALL_EMBEDDING_WARM_DAILY_TOKEN_LIMIT;

afterEach(() => {
  clearEmbeddingCacheForTests();
  if (savedWarmEnabled === undefined)
    delete process.env.RECALL_EMBEDDING_WARM_ENABLED;
  else process.env.RECALL_EMBEDDING_WARM_ENABLED = savedWarmEnabled;
  if (savedCountLimit === undefined)
    delete process.env.RECALL_EMBEDDING_WARM_DAILY_LIMIT;
  else process.env.RECALL_EMBEDDING_WARM_DAILY_LIMIT = savedCountLimit;
  if (savedTokenLimit === undefined)
    delete process.env.RECALL_EMBEDDING_WARM_DAILY_TOKEN_LIMIT;
  else process.env.RECALL_EMBEDDING_WARM_DAILY_TOKEN_LIMIT = savedTokenLimit;
  delete (aiService as { embedTexts?: unknown }).embedTexts;
  vi.restoreAllMocks();
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("handles zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe("embedding cache metrics", () => {
  it("exposes hit rate helpers", () => {
    clearEmbeddingCacheForTests();
    resetEmbeddingCacheMetricsForTests();
    const m = getEmbeddingCacheMetrics();
    expect(m.itemHitRate).toBe(1);
    expect(m.itemApiCalls).toBe(0);
  });

  it("does not call AI when embedding warm is off by default", async () => {
    delete process.env.RECALL_EMBEDDING_WARM_ENABLED;
    const embedTexts = vi.fn().mockResolvedValue([[1, 0]]);
    Object.assign(aiService, { embedTexts });
    vi.spyOn(aiService, "getStatus").mockReturnValue({
      enabled: true,
      model: "test",
      embeddingModel: "test-embedding",
      degraded: false,
      degradedReason: null,
    });

    warmEntityEmbedding("user-1", {
      entityType: "note",
      entityId: "note-1",
      text: "permit renewal",
    });
    await Promise.resolve();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("enforces warm count and token caps", () => {
    process.env.RECALL_EMBEDDING_WARM_DAILY_LIMIT = "2";
    process.env.RECALL_EMBEDDING_WARM_DAILY_TOKEN_LIMIT = "10";
    expect(
      embeddingWarmWithinDailyCaps({ calls: 1, totalTokens: 5 }, "eight chars"),
    ).toBe(true);
    expect(
      embeddingWarmWithinDailyCaps({ calls: 2, totalTokens: 0 }, "short"),
    ).toBe(false);
    expect(
      embeddingWarmWithinDailyCaps({ calls: 0, totalTokens: 9 }, "eight chars"),
    ).toBe(false);
  });

  it("does not call AI again for an identical content-hash cache hit", async () => {
    const embedTexts = vi.fn().mockResolvedValue([[1, 0]]);
    Object.assign(aiService, { embedTexts });
    vi.spyOn(aiService, "getStatus").mockReturnValue({
      enabled: true,
      model: "test",
      embeddingModel: "test-embedding",
      degraded: false,
      degradedReason: null,
    });
    const item = {
      entityType: "note",
      entityId: "note-cache",
      text: "same content",
    };

    await embedItemsCached("user-1", [item]);
    await embedItemsCached("user-1", [item]);
    expect(embedTexts).toHaveBeenCalledTimes(1);
  });

  it("returns no semantic vectors without generating missing rows during Ask retrieval", async () => {
    const embedTexts = vi.fn().mockResolvedValue([[1, 0]]);
    Object.assign(aiService, { embedTexts });
    vi.spyOn(aiService, "getStatus").mockReturnValue({
      enabled: true,
      model: "test",
      embeddingModel: "test-embedding",
      degraded: false,
      degradedReason: null,
    });

    await expect(
      embedItemsCached(
        "user-1",
        [
          {
            entityType: "source_record",
            entityId: "evernote-1",
            text: "Evernote permit renewal details",
          },
        ],
        { generateMissing: false, purpose: "retrieval" },
      ),
    ).resolves.toBeNull();
    expect(embedTexts).not.toHaveBeenCalled();
  });
});
