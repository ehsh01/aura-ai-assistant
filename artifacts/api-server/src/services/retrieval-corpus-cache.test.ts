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
    setRetrievalCorpusCache("u1", "full", corpus);

    expect(getRetrievalCorpusCache("u1", "full")).toEqual(corpus);
    const hit = getRetrievalCorpusCache<typeof corpus>("u1", "full");
    expect(hit?.records[0]?.text).toContain(secret);

    const output = redactSensitiveValue({
      answer: hit?.records[0]?.text ?? "",
    });
    expect(output.answer).toBe("SSH password: [hidden credential]");
    expect(output.answer).not.toContain(secret);
  });

  it("returns independent shallow record copies on every hit", () => {
    const corpus = {
      records: [
        {
          entityType: "note",
          entityId: "n1",
          title: "Original title",
          text: "Original text",
        },
      ],
      people: [{ id: "p1", displayName: "Person One" }],
      tasks: [{ id: "t1", title: "Original task" }],
    };
    setRetrievalCorpusCache("u1", "full", corpus);

    const first = getRetrievalCorpusCache<typeof corpus>("u1", "full")!;
    first.records[0]!.title = "Mutated title";
    first.records.push({
      entityType: "note",
      entityId: "n2",
      title: "Injected",
      text: "Injected",
    });
    first.people[0]!.displayName = "Mutated person";
    first.tasks[0]!.title = "Mutated task";

    const second = getRetrievalCorpusCache<typeof corpus>("u1", "full")!;
    expect(second).toEqual(corpus);
    expect(second).not.toBe(first);
    expect(second.records).not.toBe(first.records);
    expect(second.records[0]).not.toBe(first.records[0]);
  });

  it("isolates entries by user", () => {
    setRetrievalCorpusCache("user-a", "full", {
      records: ["user-a-only"],
    });

    expect(getRetrievalCorpusCache("user-b", "full")).toBeNull();
    expect(getRetrievalCorpusCache("user-a", "full")).toEqual({
      records: ["user-a-only"],
    });
  });

  it("invalidates every corpus mode for a user", () => {
    setRetrievalCorpusCache("u1", "slim-link", { records: ["link"] });
    setRetrievalCorpusCache("u1", "full", { records: ["full"] });
    setRetrievalCorpusCache("u2", "slim-link", { records: ["other"] });

    invalidateRetrievalCorpusCache("u1");

    expect(getRetrievalCorpusCache("u1", "slim-link")).toBeNull();
    expect(getRetrievalCorpusCache("u1", "full")).toBeNull();
    expect(getRetrievalCorpusCache("u2", "slim-link")).not.toBeNull();
  });

  it("has a 45-second TTL and hard entry and byte caps", () => {
    const stats = retrievalCorpusCacheStatsForTests();
    expect(stats.ttlMs).toBeGreaterThanOrEqual(30_000);
    expect(stats.ttlMs).toBeLessThanOrEqual(60_000);
    expect(stats.maxBytes).toBe(3 * 1024 * 1024);
    expect(stats.maxEntries).toBeGreaterThan(0);

    setRetrievalCorpusCache("large", "full", {
      text: "x".repeat(stats.maxBytes + 1),
    });
    expect(getRetrievalCorpusCache("large", "full")).toBeNull();
    expect(retrievalCorpusCacheStatsForTests().bytes).toBeLessThanOrEqual(
      stats.maxBytes,
    );
  });

  it.each(["false", " FALSE ", "0", " Off ", "NO"])(
    "does not retain inputs when disabled with %j",
    (value) => {
      vi.stubEnv("RECALL_RETRIEVAL_CORPUS_CACHE_ENABLED", value);
      setRetrievalCorpusCache("u1", "full", { records: ["ignored"] });
      expect(getRetrievalCorpusCache("u1", "full")).toBeNull();
    },
  );

  it("remains enabled by default", () => {
    setRetrievalCorpusCache("u1", "full", { records: ["cached"] });
    expect(getRetrievalCorpusCache("u1", "full")).toEqual({
      records: ["cached"],
    });
  });
});
