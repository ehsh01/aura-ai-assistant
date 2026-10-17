import { describe, expect, it } from "vitest";
import {
  buildGraphHighlightLookup,
  graphNodeOpacity,
  isHighlightedEdge,
} from "./graph-highlight";

describe("knowledge graph highlight state", () => {
  const lookup = buildGraphHighlightLookup([
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]);

  it("highlights active edges and keeps direct neighbors fully visible", () => {
    expect(isHighlightedEdge("a", "b", "b")).toBe(true);
    expect(isHighlightedEdge("b", "c", "b")).toBe(true);
    expect(graphNodeOpacity("a", "b", lookup.get("b"))).toBe(1);
    expect(graphNodeOpacity("b", "b", lookup.get("b"))).toBe(1);
    expect(graphNodeOpacity("c", "b", lookup.get("b"))).toBe(1);
  });

  it("dims non-neighbors while leaving the default state unchanged", () => {
    expect(graphNodeOpacity("d", "b", lookup.get("b"))).toBe(0.18);
    expect(isHighlightedEdge("a", "c", "b")).toBe(false);
    expect(graphNodeOpacity("d", null, undefined)).toBe(1);
  });
});
