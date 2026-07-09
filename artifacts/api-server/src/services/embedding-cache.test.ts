import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./embedding-cache";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("handles zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});
