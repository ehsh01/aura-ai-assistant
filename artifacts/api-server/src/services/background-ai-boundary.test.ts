import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("background AI call-site guards", () => {
  it("guards capture classification at the model-call boundary", async () => {
    const text = await source("capture-pipeline.ts");
    expect(text).toMatch(
      /allowBackgroundAi\("capture_classify", userId\)[\s\S]*aiService\.classifyCapture/,
    );
  });

  it("guards per-note deadline and per-record waiting extraction", async () => {
    const [attention, waiting] = await Promise.all([
      source("attention-extract.ts"),
      source("waiting-extract.ts"),
    ]);
    expect(attention).toMatch(
      /scanNoteForDeadlines[\s\S]*allowBackgroundAi\("deadline_extract", userId\)[\s\S]*aiService\.extractDeadline/,
    );
    expect(waiting).toMatch(
      /extractWaitingFromRecord[\s\S]*allowBackgroundAi\("waiting_extract", userId\)[\s\S]*aiService\.extractWaitingCommitments/,
    );
  });

  it("guards waiting-outcome classification", async () => {
    const text = await source("waiting-outcomes.ts");
    expect(text).toMatch(
      /processWaitingOutcomesForUser[\s\S]*allowBackgroundAi\("waiting_outcome", userId\)[\s\S]*aiService\.classifyWaitingReply/,
    );
  });

  it("guards every warm embedding centrally, including attachment and connector callers", async () => {
    const [cache, attachment, connectors] = await Promise.all([
      source("embedding-cache.ts"),
      source("attachment-text-extract.ts"),
      source("connectors.ts"),
    ]);
    expect(cache).toMatch(
      /allowEmbeddingWarm[\s\S]*allowBackgroundAi\("embedding_warm", userId\)/,
    );
    expect(cache).toMatch(
      /warmEntityEmbedding[\s\S]*RECALL_EMBEDDING_WARM_ENABLED[\s\S]*purpose: "warm"/,
    );
    expect(attachment).toContain("warmEntityEmbedding(row.userId");
    expect(connectors).toContain("warmEntityEmbedding(userId");
  });
});
