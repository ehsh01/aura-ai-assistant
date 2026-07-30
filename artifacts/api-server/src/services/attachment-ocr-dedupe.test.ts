import { describe, expect, it } from "vitest";
import { OCR_JOB_PREFIX, ocrJobId } from "./attachment-text-extract";

/**
 * The job queue de-duplicates on job id alone. The OCR backfill re-selects
 * attachments every 15s while they are still unprocessed, so a non-deterministic
 * id here meant the same image was billed to the vision model repeatedly.
 */
describe("OCR job identity", () => {
  it("is stable across calls for the same attachment", () => {
    expect(ocrJobId("att-123")).toBe(ocrJobId("att-123"));
  });

  it("differs between attachments", () => {
    expect(ocrJobId("att-123")).not.toBe(ocrJobId("att-456"));
  });

  it("uses the prefix the backfill query filters on", () => {
    // The backfill skips rows where a job named prefix||id already exists, so
    // these two must stay in sync.
    expect(ocrJobId("att-123")).toBe(`${OCR_JOB_PREFIX}att-123`);
  });

  it("fits the 64-character job id column", () => {
    const long = "a".repeat(200);
    expect(ocrJobId(long).length).toBeLessThanOrEqual(64);
  });
});
