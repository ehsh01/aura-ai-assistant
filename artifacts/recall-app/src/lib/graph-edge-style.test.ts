import { describe, expect, it } from "vitest";
import { graphEdgeCoreWidth, graphEdgeGlowWidth } from "./graph-edge-style";

describe("knowledge graph edge styling", () => {
  it("renders a two-pixel core at default zoom", () => {
    expect(graphEdgeCoreWidth(1)).toBe(2);
  });

  it("keeps the core above one CSS pixel at every supported zoom", () => {
    expect(graphEdgeCoreWidth(0)).toBe(1.35);
    expect(graphEdgeCoreWidth(0.2)).toBe(1.35);
    expect(graphEdgeCoreWidth(Number.NaN)).toBe(2);
  });

  it("caps core and glow widths when zoomed in", () => {
    const coreWidth = graphEdgeCoreWidth(100);
    expect(coreWidth).toBe(3);
    expect(graphEdgeGlowWidth(coreWidth)).toBe(6);
  });
});
