import { describe, expect, it } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { extractTextFromAttachmentFile } from "./attachment-text-extract";

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
