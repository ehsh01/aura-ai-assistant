import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Evernote Ask boundary", () => {
  it("keeps MCP transport out of retrieval and answer execution", async () => {
    const [retrieval, queryEngine, connectors] = await Promise.all([
      readFile(new URL("./retrieval.ts", import.meta.url), "utf8"),
      readFile(new URL("./query-engine.ts", import.meta.url), "utf8"),
      readFile(new URL("./connectors.ts", import.meta.url), "utf8"),
    ]);
    for (const source of [retrieval, queryEngine]) {
      expect(source).not.toMatch(/evernote-mcp|mcp\.evernote\.com|callTool\s*\(/);
    }
    expect(connectors).not.toMatch(
      /from\s+["']\.\.\/connectors\/evernote-mcp["']/,
    );
  });
});
