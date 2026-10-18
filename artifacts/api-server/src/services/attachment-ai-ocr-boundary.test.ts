import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("explicit attachment AI OCR boundaries", () => {
  it("uses the strict shared OpenAI client with attachment_ocr_ai attribution", async () => {
    const source = await readFile(
      new URL("attachment-ai-ocr.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("createOpenAiClient({");
    expect(source).toContain('feature: "attachment_ocr_ai"');
    expect(source).toContain("redactOutput: false");
    expect(source).not.toMatch(/\bnew\s+OpenAI\s*\(/);
    expect(source).not.toContain("recordAiUsage(");
  });

  it("scopes both OCR cache reads and writes by user", async () => {
    const source = await readFile(
      new URL("attachment-ai-ocr.ts", import.meta.url),
      "utf8",
    );
    const cacheLookup = source.slice(
      source.indexOf("const [cached]"),
      source.indexOf("if (cached?.aiOcrAt)"),
    );
    expect(cacheLookup).toContain("eq(noteAttachments.userId, userId)");
    expect(cacheLookup).toContain("eq(noteAttachments.contentHash, contentHash)");

    const localSource = await readFile(
      new URL("attachment-text-extract.ts", import.meta.url),
      "utf8",
    );
    const localLookup = localSource.slice(
      localSource.indexOf("const [reusable]"),
      localSource.indexOf("return reusable?.extractedAt"),
    );
    expect(localLookup).toContain("eq(noteAttachments.userId, row.userId)");
  });
});
