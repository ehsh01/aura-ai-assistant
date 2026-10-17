import { describe, expect, it } from "vitest";
import { ATTACHMENT_TEXT_JOB_PREFIX, attachmentTextJobId } from "./attachment-text-extract";

/**
 * The upload path can encounter the same attachment more than once during an
 * idempotent import, so its local extraction job id must stay deterministic.
 */
describe("OCR job identity", () => {
  it("is stable across calls for the same attachment", () => {
    expect(attachmentTextJobId("att-123")).toBe(attachmentTextJobId("att-123"));
  });

  it("differs between attachments", () => {
    expect(attachmentTextJobId("att-123")).not.toBe(attachmentTextJobId("att-456"));
  });

  it("uses the upload-time extraction prefix", () => {
    expect(attachmentTextJobId("att-123")).toBe(`${ATTACHMENT_TEXT_JOB_PREFIX}att-123`);
  });

  it("fits the 64-character job id column", () => {
    const long = "a".repeat(200);
    expect(attachmentTextJobId(long).length).toBeLessThanOrEqual(64);
  });
});
