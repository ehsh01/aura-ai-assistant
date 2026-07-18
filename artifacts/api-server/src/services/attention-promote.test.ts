import { describe, expect, it } from "vitest";
import { isDeadlineScanned } from "./attention-promote";

describe("isDeadlineScanned", () => {
  it("detects scan marker", () => {
    expect(isDeadlineScanned({ deadlineScanAt: "2026-07-18T12:00:00Z" })).toBe(true);
  });

  it("is false when unmarked", () => {
    expect(isDeadlineScanned({})).toBe(false);
    expect(isDeadlineScanned({ deadlineScanAt: "" })).toBe(false);
  });
});
