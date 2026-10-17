import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenAI instrumentation boundary", () => {
  it("prevents any API call site from constructing an uninstrumented client", async () => {
    const srcRoot = path.resolve(import.meta.dirname, "..");
    const files = (await readdir(srcRoot, { recursive: true }))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => path.join(srcRoot, file));

    const bypasses: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(srcRoot, file);
      if (relative === "services/openai-client.ts") continue;
      const runtimeImports = source
        .split("\n")
        .filter(
          (line) =>
            line.includes('from "openai"') &&
            !line.trimStart().startsWith("import type ") &&
            line.trim() !== 'import { toFile } from "openai";',
        );
      if (
        /\bnew\s+OpenAI\s*\(/.test(source) ||
        /import\s+OpenAI(?:\s*,|\s+from)\s+["']openai["']/.test(source) ||
        runtimeImports.length > 0
      ) {
        bypasses.push(relative);
      }
    }

    expect(bypasses).toEqual([]);
  });
});
