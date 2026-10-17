import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  EvernoteAttachmentTooLargeError,
  evernoteAttachmentMaxBytes,
  evernotePdfParseMaxBytes,
  extractImageTextInMemory,
  extractPdfTextInMemory,
  fetchAndExtractEvernoteAttachment,
  responseBytesInMemory,
} from "./evernote-attachment-extract";

const dirs: string[] = [];

afterEach(async () => {
  delete process.env.EVERNOTE_ATTACHMENT_MAX_BYTES;
  delete process.env.EVERNOTE_PDF_PARSE_MAX_BYTES;
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
    expect(responseBytesInMemory.toString()).not.toContain("Buffer.concat");
  });

  it("defaults to 20MB and hard-caps configuration at 50MB", () => {
    expect(evernoteAttachmentMaxBytes()).toBe(20 * 1024 * 1024);
    process.env.EVERNOTE_ATTACHMENT_MAX_BYTES = String(100 * 1024 * 1024);
    expect(evernoteAttachmentMaxBytes()).toBe(50 * 1024 * 1024);
    expect(evernotePdfParseMaxBytes()).toBe(15 * 1024 * 1024);
    process.env.EVERNOTE_PDF_PARSE_MAX_BYTES = String(40 * 1024 * 1024);
    expect(evernotePdfParseMaxBytes()).toBe(15 * 1024 * 1024);
  });

  it("rejects metadata and Content-Length oversize before reading the body", async () => {
    let fetchCalls = 0;
    await expect(
      fetchAndExtractEvernoteAttachment(
        "https://signed.example/metadata-large",
        {
          mime: "application/octet-stream",
          fileName: "large.bin",
          sizeBytes: 20 * 1024 * 1024 + 1,
        },
        {
          fetch: (async () => {
            fetchCalls += 1;
            return new Response();
          }) as typeof fetch,
          loadCheck: async () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(EvernoteAttachmentTooLargeError);
    expect(fetchCalls).toBe(0);

    let cancels = 0;
    const oversizedResponse = {
      headers: new Headers({
        "content-length": String(20 * 1024 * 1024 + 1),
      }),
      body: {
        cancel: async () => {
          cancels += 1;
        },
      },
    } as unknown as Response;
    await expect(
      fetchAndExtractEvernoteAttachment(
        "https://signed.example/header-large",
        { mime: "application/octet-stream", fileName: "large.bin" },
        {
          fetch: (async () => oversizedResponse) as typeof fetch,
          loadCheck: async () => undefined,
        },
      ),
    ).rejects.toBeInstanceOf(EvernoteAttachmentTooLargeError);
    expect(cancels).toBe(1);
  });

  it("skips pdf-parse above 15MB and load-checks before smaller parses", async () => {
    let loadChecks = 0;
    expect(
      await extractPdfTextInMemory(
        Buffer.alloc(15 * 1024 * 1024 + 1),
        async () => {
          loadChecks += 1;
        },
      ),
    ).toBe("");
    expect(loadChecks).toBe(0);

    await expect(
      extractPdfTextInMemory(Buffer.from("not a pdf"), async () => {
        loadChecks += 1;
      }),
    ).rejects.toBeDefined();
    expect(loadChecks).toBe(1);
  });

  it("discards fetched bytes without creating temp files and dedupes by hash", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "recall-evernote-test-"));
    dirs.push(scratch);
    const data = Buffer.from("binary attachment body");
    const fetcher = async () => new Response(data);
    const first = await fetchAndExtractEvernoteAttachment(
      "https://signed.example/one",
      { mime: "application/octet-stream", fileName: "sample.bin" },
      { fetch: fetcher as typeof fetch, loadCheck: async () => undefined },
    );
    const second = await fetchAndExtractEvernoteAttachment(
      "https://signed.example/two",
      { mime: "application/octet-stream", fileName: "copy.bin" },
      { fetch: fetcher as typeof fetch, loadCheck: async () => undefined },
    );
    expect(first.sha256).toBe(second.sha256);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("load-checks immediately before download and before buffering", async () => {
    const events: string[] = [];
    await fetchAndExtractEvernoteAttachment(
      "https://signed.example/load-gated",
      {
        mime: "application/octet-stream",
        fileName: "sample.bin",
        sizeBytes: 4,
      },
      {
        fetch: (async () => {
          events.push("fetch");
          return new Response(Buffer.from("data"), {
            headers: { "content-length": "4" },
          });
        }) as typeof fetch,
        loadCheck: async () => {
          events.push("load");
        },
      },
    );
    expect(events).toEqual(["load", "fetch", "load"]);
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
        loadCheck: async () => undefined,
      },
    );
    expect(calls).toBe(0);
    expect(result.textEngine).toBeNull();
  });

  it("defers image OCR outside night hours without spawning", async () => {
    let spawned = false;
    await expect(
      extractImageTextInMemory(
        Buffer.alloc(20 * 1024),
        (() => {
          spawned = true;
          throw new Error("must not spawn");
        }) as never,
        { now: new Date("2026-10-17T15:00:00Z"), loadCheck: async () => undefined },
      ),
    ).rejects.toMatchObject({ name: "EvernoteWatchdogPauseError" });
    expect(spawned).toBe(false);
  });

  it("load-checks then runs Tesseract under nice with one OMP thread", async () => {
    let loadChecks = 0;
    const events: string[] = [];
    let invocation:
      | { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }
      | undefined;
    const run = ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      events.push("spawn");
      invocation = { command, args, options };
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => boolean;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stdout.write("recognized text");
        child.emit("close", 0);
      });
      return child;
    }) as never;
    const text = await extractImageTextInMemory(Buffer.alloc(20 * 1024), run, {
      now: new Date("2026-10-17T06:00:00Z"),
      loadCheck: async () => {
        loadChecks += 1;
        events.push("load");
      },
    });
    expect(text).toBe("recognized text");
    expect(loadChecks).toBe(1);
    expect(events).toEqual(["load", "spawn"]);
    expect(invocation?.command).toBe("nice");
    expect(invocation?.args.slice(0, 4)).toEqual(["-n", "19", "flock", "-x"]);
    expect(invocation?.args).toContain("tesseract");
    expect(invocation?.options.env?.OMP_THREAD_LIMIT).toBe("1");
  });

  it("keeps Evernote Tesseract execution failures retryable", async () => {
    const run = (() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => boolean;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stderr.write("bad image");
        child.emit("close", 1);
      });
      return child;
    }) as never;
    await expect(
      extractImageTextInMemory(Buffer.alloc(20 * 1024), run, {
        now: new Date("2026-10-17T06:00:00Z"),
        loadCheck: async () => undefined,
      }),
    ).rejects.toThrow("Evernote Tesseract exited 1");
  });
});
