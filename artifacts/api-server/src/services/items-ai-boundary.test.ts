import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function serviceSource(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("saved items AI boundary", () => {
  it("keeps capture, metadata, tags, and graph generation deterministic", async () => {
    const sources = await Promise.all(
      ["items.ts", "item-graph.ts", "item-tags.ts", "link-metadata.ts"].map(
        serviceSource,
      ),
    );
    const combined = sources.join("\n");

    expect(combined).not.toMatch(
      /openai-client|aiService|warmEntityEmbedding|embedding-cache|allowBackgroundAi|job-queue/,
    );
  });

  it("keeps Enter keyword-only and invokes AI only from the explicit button handler", async () => {
    const page = await readFile(
      new URL("../../../recall-app/src/pages/Everything.tsx", import.meta.url),
      "utf8",
    );

    expect(page).toMatch(
      /const runKeywordSearch = useCallback\([\s\S]*?async \(rawQuestion: string\)[\s\S]*?listSavedItems\(\{ q: question/,
    );
    expect(page).toMatch(
      /const submitKeywordSearch = \(event: FormEvent\)[\s\S]*runKeywordSearch\(ask\)/,
    );
    expect(page).toMatch(/<form[\s\S]*onSubmit=\{submitKeywordSearch\}/);
    expect(page).toMatch(
      /const submitVoiceTranscript = useCallback\([\s\S]*runKeywordSearch\(question\)/,
    );
    expect(page).toMatch(
      /const submitAskAi = async \(\)[\s\S]*queryRecallStream\(question/,
    );
    expect(page).toMatch(/onClick=\{\(\) => void submitAskAi\(\)\}/);
    expect(page).not.toMatch(/useEffect\([\s\S]{0,300}queryRecallStream/);
  });

  it("bounds rows and body bytes without selecting attachment text into Node", async () => {
    const [items, graph] = await Promise.all([
      serviceSource("items.ts"),
      serviceSource("item-graph.ts"),
    ]);

    expect(items).toContain("ITEM_LIST_BODY_MAX_CHARS = 12_000");
    expect(items).toContain("ITEM_GRAPH_BODY_MAX_CHARS = 2_000");
    expect(items).toContain("ITEM_DETAIL_BODY_MAX_CHARS = 50_000");
    expect(items).toMatch(/left\(i\.body_text, \$\{filters\.bodyTextLimit\}\)/);
    expect(items).toMatch(/left\(n\.preview, 280\)/);
    expect(items).not.toMatch(/n\.content AS body_text|left\(n\.content/);
    expect(items).toMatch(
      /left\(coalesce\(sr\.record_text, ''\), \$\{filters\.bodyTextLimit\}\)/,
    );
    expect(items).not.toMatch(/note_attachments|extracted_text/);
    expect(graph).toContain("LIMIT ${quota + 1}");
    expect(graph).toContain("OFFSET ${offset}");
    expect(graph).toContain("ITEM_GRAPH_BODY_MAX_CHARS");
    expect(graph).not.toMatch(/warmEntityEmbedding|embedding-cache|aiService/);
  });
});
