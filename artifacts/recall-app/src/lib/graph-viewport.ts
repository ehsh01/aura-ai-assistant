export type GraphViewportRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type GraphFitTransform = {
  x: number;
  y: number;
  scale: number;
  stretchX: number;
  stretchY: number;
};

export function graphViewportSize(rect: GraphViewportRect): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, rect.right - rect.left),
    height: Math.max(1, rect.bottom - rect.top),
  };
}

export function graphResponsiveStretch(
  canvasWidth: number,
): Pick<GraphFitTransform, "stretchX" | "stretchY"> {
  return canvasWidth < 640
    ? { stretchX: 0.64, stretchY: 1.08 }
    : { stretchX: 1, stretchY: 1 };
}

export function calculateGraphFit(input: {
  canvasWidth: number;
  canvasHeight: number;
  viewport: GraphViewportRect;
  graph: GraphViewportRect;
  minScale?: number;
  maxScale?: number;
}): GraphFitTransform {
  const { stretchX, stretchY } = graphResponsiveStretch(input.canvasWidth);
  const viewport = graphViewportSize(input.viewport);
  const graphWidth = Math.max(1, input.graph.right - input.graph.left) * stretchX;
  const graphHeight =
    Math.max(1, input.graph.bottom - input.graph.top) * stretchY;
  const scale = Math.max(
    input.minScale ?? 0.12,
    Math.min(
      input.maxScale ?? 1.5,
      Math.min(viewport.width / graphWidth, viewport.height / graphHeight),
    ),
  );
  const targetX = (input.viewport.left + input.viewport.right) / 2;
  const targetY = (input.viewport.top + input.viewport.bottom) / 2;
  const graphCenterX =
    ((input.graph.left + input.graph.right) / 2) * stretchX;
  const graphCenterY =
    ((input.graph.top + input.graph.bottom) / 2) * stretchY;
  return {
    scale,
    stretchX,
    stretchY,
    x: targetX - input.canvasWidth / 2 - graphCenterX * scale,
    y: targetY - input.canvasHeight / 2 - graphCenterY * scale,
  };
}

export function clampGraphLabelBox(
  candidate: { left: number; top: number },
  width: number,
  height: number,
  viewport: GraphViewportRect,
): GraphViewportRect {
  const left = Math.min(
    Math.max(candidate.left, viewport.left),
    Math.max(viewport.left, viewport.right - width),
  );
  const top = Math.min(
    Math.max(candidate.top, viewport.top),
    Math.max(viewport.top, viewport.bottom - height),
  );
  return { left, top, right: left + width, bottom: top + height };
}

export function shouldRenderGraphLabel(input: {
  hub: boolean;
  hovered: boolean;
  labelsEnabled: boolean;
  scale: number;
  mobile: boolean;
}): boolean {
  if (input.hovered) return true;
  if (input.hub) return true;
  const threshold = input.mobile ? 0.68 : 0.42;
  return input.labelsEnabled && input.scale > threshold;
}
