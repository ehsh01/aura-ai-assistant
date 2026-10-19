import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redactSensitiveValue } from "./secret-redaction";
import {
  getRetrievalCorpusCache,
  invalidateRetrievalCorpusCache,
  resetRetrievalCorpusCacheForTests,
  retrievalCorpusCacheStatsForTests,
  setRetrievalCorpusCache,
} from "./retrieval-corpus-cache";

beforeEach(() => {
  resetRetrievalCorpusCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetRetrievalCorpusCacheForTests();
});

describe("retrieval corpus cache", () => {
  it("keeps pre-redaction inputs but redacts every cache-hit answer", () => {
    const secret = "FakePsychiatryPassword!42";
    const corpus = {
      records: [
        {
          entityType: "note",
          entityId: "n1",
          title: "Inventory",
          text: `SSH password: ${secret}`,
        },
      ],
      people: [],
      tasks: [],
    };
    setRetrievalCorpusCache("u1", "standard", corpus);

    expect(getRetrievalCorpusCache("u1", "standard")).toBe(corpus);
    const hit = getRetrievalCorpusCache<typeof corpus>("u1", "standard");
    expect(hit?.records[0]?.text).toContain(secret);

    const output = redactSensitiveValue({
      answer: hit?.records[0]?.text ?? "",
    });
    expect(output.answer).toBe("SSH password: [hidden credential]");
    expect(output.answer).not.toContain(secret);
  });

  it("invalidates every corpus mode for a user", () => {
    setRetrievalCorpusCache("u1", "standard", { records: ["standard"] });
    setRetrievalCorpusCache("u1", "email", { records: ["email"] });
    setRetrievalCorpusCache("u2", "standard", { records: ["other"] });

    invalidateRetrievalCorpusCache("u1");

    expect(getRetrievalCorpusCache("u1", "standard")).toBeNull();
    expect(getRetrievalCorpusCache("u1", "email")).toBeNull();
    expect(getRetrievalCorpusCache("u2", "standard")).not.toBeNull();
  });

  it("has a 45-second TTL and hard entry and byte caps", () => {
    const stats = retrievalCorpusCacheStatsForTests();
    expect(stats.ttlMs).toBeGreaterThanOrEqual(30_000);
    expect(stats.ttlMs).toBeLessThanOrEqual(60_000);
    expect(stats.maxBytes).toBe(3 * 1024 * 1024);
    expect(stats.maxEntries).toBeGreaterThan(0);

    setRetrievalCorpusCache("large", "standard", {
      text: "x".repeat(stats.maxBytes + 1),
    });
    expect(getRetrievalCorpusCache("large", "standard")).toBeNull();
    expect(retrievalCorpusCacheStatsForTests().bytes).toBeLessThanOrEqual(
      stats.maxBytes,
    );
  });

  it("can be disabled without retaining inputs", () => {
    vi.stubEnv("RECALL_RETRIEVAL_CORPUS_CACHE_ENABLED", "false");
    setRetrievalCorpusCache("u1", "standard", { records: ["ignored"] });
    expect(getRetrievalCorpusCache("u1", "standard")).toBeNull();
  });
});
