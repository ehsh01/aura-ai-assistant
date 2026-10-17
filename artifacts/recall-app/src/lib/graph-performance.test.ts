import { describe, expect, it } from "vitest";
import { shouldUseGridFallback } from "./graph-performance";

describe("graph performance fallback", () => {
  it("falls back for reduced motion and low-end devices", () => {
    expect(
      shouldUseGridFallback({
        reducedMotion: true,
        hardwareConcurrency: 8,
        deviceMemory: 8,
      }),
    ).toBe(true);
    expect(
      shouldUseGridFallback({
        reducedMotion: false,
        hardwareConcurrency: 2,
        deviceMemory: 8,
      }),
    ).toBe(true);
    expect(
      shouldUseGridFallback({
        reducedMotion: false,
        hardwareConcurrency: 8,
        deviceMemory: 2,
      }),
    ).toBe(true);
  });

  it("keeps the graph enabled for capable devices", () => {
    expect(
      shouldUseGridFallback({
        reducedMotion: false,
        hardwareConcurrency: 4,
        deviceMemory: 4,
      }),
    ).toBe(false);
  });
});
