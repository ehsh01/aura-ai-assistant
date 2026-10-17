import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function serviceSource(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("saved items AI boundary", () => {
  it("keeps capture, metadata, tags, and graph generation deterministic", async () => {
    const sources = await Promise.all(
      ["items.ts", "item-graph.ts", "item-tags.ts", "link-metadata.ts"].map(serviceSource),
    );
    const combined = sources.join("\n");

    expect(combined).not.toMatch(
      /openai-client|aiService|warmEntityEmbedding|embedding-cache|allowBackgroundAi|job-queue/,
    );
  });

  it("invokes Ask only from the explicit Explore submit handler", async () => {
    const page = await readFile(
      new URL("../../../recall-app/src/pages/Everything.tsx", import.meta.url),
      "utf8",
    );

    expect(page).toMatch(
      /const submitAsk = async \(event: FormEvent\)[\s\S]*queryRecallStream\(question/,
    );
    expect(page).toMatch(/<form onSubmit=\{submitAsk\}/);
    expect(page).not.toMatch(/useEffect\([\s\S]{0,300}queryRecallStream/);
  });
});
