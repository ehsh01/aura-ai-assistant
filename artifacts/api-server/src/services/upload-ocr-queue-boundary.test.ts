import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("upload OCR durable queue boundary", () => {
  it("refunds night/load deferrals and keeps the job queued", async () => {
    const [worker, queue] = await Promise.all([
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-queue.ts", import.meta.url), "utf8"),
    ]);
    expect(worker).toMatch(
      /err instanceof EvernoteWatchdogPauseError[\s\S]*deferJob\(job\.id,[\s\S]*return;/,
    );
    expect(queue).toMatch(
      /export async function deferJob[\s\S]*status: "queued"[\s\S]*greatest\(\$\{jobs\.attempts\} - 1, 0\)/,
    );
  });

  it("routes real Tesseract failures through the three-attempt terminal path", async () => {
    const [extractor, worker] = await Promise.all([
      readFile(new URL("./attachment-text-extract.ts", import.meta.url), "utf8"),
      readFile(new URL("./job-worker.ts", import.meta.url), "utf8"),
    ]);
    expect(extractor).toMatch(
      /Tesseract attachment extraction failed[\s\S]*throw err/,
    );
    expect(worker).toMatch(
      /const terminal = await failJob\(job\.id,[\s\S]*if \(!terminal\)[\s\S]*scheduleExplicitJobResume/,
    );
  });
});
