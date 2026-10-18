export const GRAPH_EDGE_CORE_COLOR = "#8cfff1";
export const GRAPH_EDGE_GLOW_COLOR = "#35e9e1";
export const GRAPH_EDGE_HIGHLIGHT_COLOR = "#d8fff8";

const MIN_CORE_WIDTH = 0.675;
const BASE_CORE_WIDTH = 1;
const MAX_CORE_WIDTH = 1.5;
const GLOW_EXTRA_WIDTH = 1.6;
const MAX_GLOW_WIDTH = 3;
export const GRAPH_EDGE_OPACITY_SCALE = 0.75;

/**
 * Edge widths are expressed in CSS pixels because the graph projects node
 * positions into screen space before drawing. Widths are half the original
 * values in every state, while still growing gently rather than linearly.
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

/** Apply the owner-selected brightness reduction uniformly to every edge state. */
export function graphEdgeOpacity(alpha: number): number {
  return alpha * GRAPH_EDGE_OPACITY_SCALE;
}
