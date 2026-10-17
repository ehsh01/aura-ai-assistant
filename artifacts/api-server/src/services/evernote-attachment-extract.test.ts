import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchAndExtractEvernoteAttachment,
  responseBytesInMemory,
} from "./evernote-attachment-extract";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Evernote attachment memory-only extraction", () => {
  it("streams chunks while calculating a stable SHA-256", async () => {
    const data = Buffer.from("same bytes from a short-lived link");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(data.subarray(0, 7));
          controller.enqueue(data.subarray(7));
          controller.close();
        },
      }),
    );
    const result = await responseBytesInMemory(response);
    expect(result.data.equals(data)).toBe(true);
    expect(result.sha256).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("discards fetched bytes without creating temp files and dedupes by hash", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "recall-evernote-test-"));
    dirs.push(scratch);
    const data = Buffer.from("binary attachment body");
    const fetcher = async () => new Response(data);
    const first = await fetchAndExtractEvernoteAttachment(
      "https://signed.example/one",
      { mime: "application/octet-stream", fileName: "sample.bin" },
      { fetch: fetcher as typeof fetch },
    );
    const second = await fetchAndExtractEvernoteAttachment(
      "https://signed.example/two",
      { mime: "application/octet-stream", fileName: "copy.bin" },
      { fetch: fetcher as typeof fetch },
    );
    expect(first.sha256).toBe(second.sha256);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("skips local OCR below the 20KB image threshold", async () => {
    let calls = 0;
    const result = await fetchAndExtractEvernoteAttachment(
      "https://signed.example/tiny",
      { mime: "image/png", fileName: "tiny.png" },
      {
        fetch: (async () => new Response(Buffer.alloc(20 * 1024 - 1))) as typeof fetch,
        tesseract: async () => {
          calls += 1;
          return "should not run";
        },
      },
    );
    expect(calls).toBe(0);
    expect(result.textEngine).toBeNull();
  });
});
