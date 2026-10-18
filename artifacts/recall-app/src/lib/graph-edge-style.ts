export const GRAPH_EDGE_CORE_COLOR = "#8cfff1";
export const GRAPH_EDGE_GLOW_COLOR = "#35e9e1";
export const GRAPH_EDGE_HIGHLIGHT_COLOR = "#d8fff8";

const MIN_CORE_WIDTH = 1.35;
const BASE_CORE_WIDTH = 2;
const MAX_CORE_WIDTH = 3;
const GLOW_EXTRA_WIDTH = 3.2;
const MAX_GLOW_WIDTH = 6;

/**
 * Edge widths are expressed in CSS pixels because the graph projects node
 * positions into screen space before drawing. Keep the core above one pixel
 * when zoomed out, then grow it gently rather than scaling linearly.
 */
export function graphEdgeCoreWidth(scale: number): number {
  const safeScale = Number.isFinite(scale) ? Math.max(scale, 0) : 1;
  return Math.min(
    MAX_CORE_WIDTH,
    Math.max(MIN_CORE_WIDTH, BASE_CORE_WIDTH * Math.sqrt(safeScale)),
  );
}

export function graphEdgeGlowWidth(coreWidth: number): number {
  return Math.min(MAX_GLOW_WIDTH, coreWidth + GLOW_EXTRA_WIDTH);
}
