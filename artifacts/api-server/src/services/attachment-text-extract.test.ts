import { describe, expect, it, vi } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  attachmentContentHash,
  extractImageTextWithTesseract,
  extractTextFromAttachmentFile,
  extractWithContentHashCache,
} from "./attachment-text-extract";

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

  it("degrades gracefully when the tesseract binary is missing", async () => {
    const missing = Object.assign(new Error("spawn tesseract ENOENT"), {
      code: "ENOENT",
    });
    const run = vi.fn().mockRejectedValue(missing);

    await expect(extractImageTextWithTesseract("/tmp/missing.png", 3_000, run)).resolves.toBe("");
  });
});
