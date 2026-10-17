import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  attachmentContentHash,
  extractImageTextWithTesseract,
  extractTextFromAttachmentFile,
  extractWithContentHashCache,
} from "./attachment-text-extract";
import { evernoteDeferredError } from "./evernote-watchdog";

afterEach(() => {
  delete process.env.RECALL_UPLOAD_TESSERACT_ENABLED;
  delete process.env.RECALL_ATTACHMENT_OCR_ENABLED;
  delete process.env.TESSERACT_OCR_TIMEOUT_MS;
});

describe("attachmentContentHash", () => {
  it("returns a stable SHA-256 digest of the file bytes", () => {
    expect(attachmentContentHash(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("extractTextFromAttachmentFile", () => {
  it("extracts plain text files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "att-extract-"));
    try {
      const absPath = path.join(dir, "receipt.txt");
      await writeFile(absPath, "Invoice #8842 total $120.50 for Bryant Permit");
      const text = await extractTextFromAttachmentFile({
        absPath,
        mimeType: "text/plain",
        fileName: "receipt.txt",
        sizeBytes: 50,
      });
      expect(text.toLowerCase()).toContain("bryant");
      expect(text).toContain("8842");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("strips html to searchable text", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "att-extract-"));
    try {
      const absPath = path.join(dir, "note.html");
      await writeFile(absPath, "<html><body><p>Permit for <b>Nancy</b></p></body></html>");
      const text = await extractTextFromAttachmentFile({
        absPath,
        mimeType: "text/html",
        fileName: "note.html",
        sizeBytes: 60,
      });
      expect(text.toLowerCase()).toContain("nancy");
      expect(text).not.toContain("<p>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("attachment extraction safeguards", () => {
  it("skips extraction when the content hash was already processed", async () => {
    const extract = vi.fn().mockResolvedValue("should not run");
    const result = await extractWithContentHashCache({
      findCached: async () => ({ processed: true, text: "cached text" }),
      extract,
    });

    expect(result).toEqual({ text: "cached text", cached: true });
    expect(extract).not.toHaveBeenCalled();
  });

  it("keeps missing-Tesseract failures retryable", async () => {
    const missing = Object.assign(new Error("spawn tesseract ENOENT"), {
      code: "ENOENT",
    });
    const run = vi.fn().mockRejectedValue(missing);

    await expect(
      extractImageTextWithTesseract("/tmp/missing.png", 3_000, run, {
        now: new Date("2026-10-17T06:00:00Z"),
        loadCheck: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses a separate local OCR kill switch and skips cleanly", async () => {
    process.env.RECALL_UPLOAD_TESSERACT_ENABLED = "false";
    const run = vi.fn();
    await expect(
      extractImageTextWithTesseract("/tmp/disabled.png", 3_000, run),
    ).resolves.toBe("");
    expect(run).not.toHaveBeenCalled();
  });

  it("defers image OCR outside 1–5 AM New York without dropping it", async () => {
    const run = vi.fn();
    await expect(
      extractImageTextWithTesseract("/tmp/daytime.png", 3_000, run, {
        now: new Date("2026-10-17T15:00:00Z"),
        loadCheck: async () => undefined,
      }),
    ).rejects.toMatchObject({ name: "EvernoteWatchdogPauseError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("propagates upload-image deferral instead of persisting empty text", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
    try {
      await expect(
        extractTextFromAttachmentFile({
          absPath: "/tmp/not-read-before-night.png",
          mimeType: "image/png",
          fileName: "queued.png",
          sizeBytes: 3_000,
        }),
      ).rejects.toMatchObject({ name: "EvernoteWatchdogPauseError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers on the load check without invoking Tesseract", async () => {
    const run = vi.fn();
    await expect(
      extractImageTextWithTesseract("/tmp/loaded.png", 8 * 1024 * 1024, run, {
        now: new Date("2026-10-17T06:00:00Z"),
        loadCheck: async () => {
          throw evernoteDeferredError("not enough memory");
        },
      }),
    ).rejects.toMatchObject({ name: "EvernoteWatchdogPauseError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs under nice, flock, one OMP thread, and the configured timeout", async () => {
    process.env.RECALL_ATTACHMENT_OCR_ENABLED = "false";
    const run = vi.fn().mockResolvedValue({ stdout: "recognized" });
    await expect(
      extractImageTextWithTesseract("/tmp/night.png", 3_000, run, {
        now: new Date("2026-10-17T06:00:00Z"),
        loadCheck: async () => undefined,
      }),
    ).resolves.toBe("recognized");
    expect(run).toHaveBeenCalledWith(
      "nice",
      [
        "-n",
        "19",
        "flock",
        "-x",
        "-F",
        "/tmp/recall-tesseract.lock",
        "tesseract",
        "/tmp/night.png",
        "stdout",
      ],
      expect.objectContaining({
        timeout: 30_000,
        env: expect.objectContaining({ OMP_THREAD_LIMIT: "1" }),
      }),
    );
  });
});
