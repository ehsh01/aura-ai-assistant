import { describe, expect, it } from "vitest";
import {
  graphEdgeCoreWidth,
  graphEdgeGlowWidth,
  graphEdgeOpacity,
} from "./graph-edge-style";

describe("knowledge graph edge styling", () => {
  it("renders a one-pixel core at default zoom", () => {
    expect(graphEdgeCoreWidth(1)).toBe(1);
  });

  it("halves the minimum and fallback widths", () => {
    expect(graphEdgeCoreWidth(0)).toBe(0.675);
    expect(graphEdgeCoreWidth(0.2)).toBe(0.675);
    expect(graphEdgeCoreWidth(Number.NaN)).toBe(1);
  });

  it("caps core and glow widths when zoomed in", () => {
    const coreWidth = graphEdgeCoreWidth(100);
    expect(coreWidth).toBe(1.5);
    expect(graphEdgeGlowWidth(coreWidth)).toBe(3);
  });

  it("halves the glow at normal zoom", () => {
    expect(graphEdgeGlowWidth(graphEdgeCoreWidth(1))).toBe(2.6);
  });

  it.each([
    ["default", 0.9, 0.675],
    ["hover-highlighted", 1, 0.75],
    ["selected/focused", 0.82, 0.615],
    ["dimmed", 0.1, 0.075],
  ])("reduces the %s edge alpha by exactly 25%%", (_state, input, output) => {
    expect(graphEdgeOpacity(input)).toBeCloseTo(output, 8);
  });
});
