import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Maximize2 } from "lucide-react";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
} from "@/lib/recall-api";
import {
  buildGraphHighlightLookup,
  graphNodeOpacity,
  isHighlightedEdge,
} from "@/lib/graph-highlight";
import {
  GRAPH_EDGE_CORE_COLOR,
  GRAPH_EDGE_GLOW_COLOR,
  GRAPH_EDGE_HIGHLIGHT_COLOR,
  graphEdgeCoreWidth,
  graphEdgeGlowWidth,
} from "@/lib/graph-edge-style";
import {
  calculateGraphFit,
  clampGraphLabelBox,
  shouldRenderGraphLabel,
  type GraphViewportRect,
} from "@/lib/graph-viewport";

type LayoutNode = KnowledgeGraphNode &
  SimulationNodeDatum & {
    radius: number;
  };
type LayoutEdge = SimulationLinkDatum<LayoutNode> &
  KnowledgeGraphEdge & {
    sourceId: string;
    targetId: string;
  };
type GraphTooltip = {
  node: KnowledgeGraphNode;
  x: number;
  y: number;
  links: number;
  touch: boolean;
};

const COLORS: Record<KnowledgeGraphNodeType, string> = {
  notes: "#75baff",
  notebooks: "#6dffe0",
  tags: "#f5ca62",
  links: "#b695ff",
  files: "#ff8f82",
  evernote: "#74e59b",
};

const TYPE_BADGES: Record<KnowledgeGraphNodeType, string> = {
  notes: "note",
  notebooks: "notebook",
  tags: "tag",
  links: "link",
  files: "file",
  evernote: "evernote",
};

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function laneOffset(type: KnowledgeGraphNodeType): { x: number; y: number } {
  switch (type) {
    case "notebooks":
      return { x: -52, y: -42 };
    case "tags":
      return { x: 52, y: 42 };
    case "links":
      return { x: 36, y: -18 };
    case "files":
      return { x: 62, y: 12 };
    case "evernote":
      return { x: -62, y: 12 };
    default:
      return { x: -20, y: -8 };
  }
}

export function KnowledgeGraph({
  nodes,
  edges,
  focus,
  holo,
  labels,
  onNodeClick,
}: {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  focus: boolean;
  holo: boolean;
  labels: boolean;
  onNodeClick: (node: KnowledgeGraphNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<{ nodes: LayoutNode[]; edges: LayoutEdge[] }>({
    nodes: [],
    edges: [],
  });
  const viewRef = useRef({
    x: 0,
    y: 0,
    scale: 1,
    stretchX: 1,
    stretchY: 1,
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<GraphTooltip | null>(null);
  const [hover, setHover] = useState<GraphTooltip | null>(null);
  const [fitVersion, setFitVersion] = useState(0);
  const degree = useMemo(() => {
    const result = new Map<string, number>();
    for (const edge of edges) {
      result.set(edge.source, (result.get(edge.source) ?? 0) + 1);
      result.set(edge.target, (result.get(edge.target) ?? 0) + 1);
    }
    return result;
  }, [edges]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const layoutNodes: LayoutNode[] = nodes.map((node) => {
      const seed = stableSeed(node.id);
      const lane = laneOffset(node.type);
      return {
        ...node,
        radius: Math.max(3, Math.min(node.hub ? 13 : 9, node.value)),
        // Stable seeded positions prevent same-name tag/notebook hubs from
        // starting on top of each other before collision forces settle.
        x: lane.x + ((seed % 101) - 50) * 1.8,
        y: lane.y + (((seed >>> 8) % 101) - 50) * 1.8,
      };
    });
    const nodeIds = new Set(layoutNodes.map((node) => node.id));
    const layoutEdges: LayoutEdge[] = edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        sourceId: edge.source,
        targetId: edge.target,
      })) as LayoutEdge[];
    const highlightLookup = buildGraphHighlightLookup(edges);
    layoutRef.current = { nodes: layoutNodes, edges: layoutEdges };
    canvas.dataset.graphNodes = String(layoutNodes.length);
    canvas.dataset.graphHubs = String(
      layoutNodes.filter((node) => node.hub).length,
    );
    canvas.dataset.graphEdges = String(layoutEdges.length);
    canvas.dataset.graphNotebookEdges = String(
      layoutEdges.filter((edge) => edge.signal === "notebook").length,
    );

    let width = container.clientWidth;
    let height = container.clientHeight;
    let frame = 0;
    let renderedEdgeCoreWidth = Number.NaN;
    let visibleViewport: GraphViewportRect = {
      left: 24,
      top: 24,
      right: Math.max(25, width - 24),
      bottom: Math.max(25, height - 24),
    };
    const context = canvas.getContext("2d");
    if (!context) return;

    const measureVisibleViewport = () => {
      const canvasBounds = canvas.getBoundingClientRect();
      const mobile = width < 640;
      const sidePadding = mobile ? 18 : 36;
      const verticalPadding = mobile ? 18 : 24;
      const topBar = document.querySelector<HTMLElement>(
        "[data-graph-fit-top-overlay]",
      );
      const bottomBar = document.querySelector<HTMLElement>(
        "[data-graph-fit-bottom-overlay]",
      );
      const mobileControls = document.querySelector<HTMLElement>(
        "[data-graph-fit-mobile-controls]",
      );
      const bottomBoundary = Math.min(
        bottomBar?.getBoundingClientRect().top ?? canvasBounds.bottom,
        mobile
          ? (mobileControls?.getBoundingClientRect().top ?? canvasBounds.bottom)
          : canvasBounds.bottom,
      );
      const top = Math.max(
        verticalPadding,
        (topBar?.getBoundingClientRect().bottom ?? canvasBounds.top) -
          canvasBounds.top +
          verticalPadding,
      );
      const bottom = Math.min(
        height - verticalPadding,
        bottomBoundary - canvasBounds.top - verticalPadding,
      );
      visibleViewport =
        bottom - top >= 160
          ? {
              left: sidePadding,
              top,
              right: Math.max(sidePadding + 1, width - sidePadding),
              bottom,
            }
          : {
              left: sidePadding,
              top: verticalPadding,
              right: Math.max(sidePadding + 1, width - sidePadding),
              bottom: Math.max(verticalPadding + 1, height - verticalPadding),
            };
      canvas.dataset.graphFitTop = visibleViewport.top.toFixed(0);
      canvas.dataset.graphFitBottom = visibleViewport.bottom.toFixed(0);
    };

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      measureVisibleViewport();
      draw();
    };

    const screenPoint = (node: LayoutNode) => ({
      x:
        width / 2 +
        viewRef.current.x +
        (node.x ?? 0) *
          viewRef.current.scale *
          viewRef.current.stretchX,
      y:
        height / 2 +
        viewRef.current.y +
        (node.y ?? 0) *
          viewRef.current.scale *
          viewRef.current.stretchY,
    });

    const strokeEdgeLayer = (
      activeNodeId: string | null,
      layer: "notebook" | "structure" | "highlighted",
      lineWidth: number,
      strokeStyle: string,
      alpha: number,
    ) => {
      context.beginPath();
      for (const edge of layoutEdges) {
        const source = edge.source as LayoutNode;
        const target = edge.target as LayoutNode;
        if (typeof source !== "object" || typeof target !== "object") continue;
        if (layer === "notebook" && edge.signal !== "notebook") continue;
        if (layer === "structure" && edge.signal === "notebook") continue;
        if (
          layer === "highlighted" &&
          !isHighlightedEdge(edge.sourceId, edge.targetId, activeNodeId)
        ) {
          continue;
        }
        context.moveTo(
          width / 2 +
            viewRef.current.x +
            (source.x ?? 0) *
              viewRef.current.scale *
              viewRef.current.stretchX,
          height / 2 +
            viewRef.current.y +
            (source.y ?? 0) *
              viewRef.current.scale *
              viewRef.current.stretchY,
        );
        context.lineTo(
          width / 2 +
            viewRef.current.x +
            (target.x ?? 0) *
              viewRef.current.scale *
              viewRef.current.stretchX,
          height / 2 +
            viewRef.current.y +
            (target.y ?? 0) *
              viewRef.current.scale *
              viewRef.current.stretchY,
        );
      }
      context.globalAlpha = alpha;
      context.lineWidth = lineWidth;
      context.strokeStyle = strokeStyle;
      context.stroke();
    };

    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        context.clearRect(0, 0, width, height);
        canvas.dataset.graphScale = viewRef.current.scale.toFixed(3);
        context.save();
        const activeNodeId = hoverRef.current?.node.id ?? null;
        const activeNeighbors = activeNodeId
          ? highlightLookup.get(activeNodeId)
          : undefined;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.shadowBlur = 0;
        const edgeCoreWidth = graphEdgeCoreWidth(viewRef.current.scale);
        const edgeGlowWidth = graphEdgeGlowWidth(edgeCoreWidth);
        if (edgeCoreWidth !== renderedEdgeCoreWidth) {
          canvas.dataset.graphEdgeWidth = edgeCoreWidth.toFixed(2);
          canvas.dataset.graphEdgeGlowWidth = edgeGlowWidth.toFixed(2);
          renderedEdgeCoreWidth = edgeCoreWidth;
        }

        // Shared-notebook stars stay legible with a dimmer batched pair;
        // higher-signal tag/item edges retain the bright core and glow. Hover
        // adds only two bounded passes, with no per-edge shadows or point
        // objects allocated during animation frames.
        strokeEdgeLayer(
          activeNodeId,
          "notebook",
          edgeGlowWidth,
          GRAPH_EDGE_GLOW_COLOR,
          activeNodeId ? 0.03 : focus ? 0.06 : 0.08,
        );
        strokeEdgeLayer(
          activeNodeId,
          "notebook",
          edgeCoreWidth,
          GRAPH_EDGE_CORE_COLOR,
          activeNodeId ? 0.1 : focus ? 0.3 : 0.4,
        );
        strokeEdgeLayer(
          activeNodeId,
          "structure",
          edgeGlowWidth,
          GRAPH_EDGE_GLOW_COLOR,
          activeNodeId ? 0.1 : focus ? 0.22 : 0.28,
        );
        strokeEdgeLayer(
          activeNodeId,
          "structure",
          edgeCoreWidth,
          GRAPH_EDGE_CORE_COLOR,
          activeNodeId ? 0.2 : focus ? 0.82 : 0.9,
        );
        if (activeNodeId) {
          strokeEdgeLayer(
            activeNodeId,
            "highlighted",
            graphEdgeGlowWidth(edgeCoreWidth + 0.8),
            GRAPH_EDGE_GLOW_COLOR,
            0.46,
          );
          strokeEdgeLayer(
            activeNodeId,
            "highlighted",
            edgeCoreWidth + 0.8,
            GRAPH_EDGE_HIGHLIGHT_COLOR,
            1,
          );
        }
        context.shadowBlur = 0;

        for (const node of layoutNodes) {
          const point = screenPoint(node);
          const radius = Math.max(
            2.2,
            node.radius * Math.sqrt(viewRef.current.scale),
          );
          const highlightOpacity = graphNodeOpacity(
            node.id,
            activeNodeId,
            activeNeighbors,
          );
          context.globalAlpha =
            highlightOpacity * (focus && !activeNodeId && !node.hub ? 0.72 : 1);
          if (holo) {
            context.shadowColor = COLORS[node.type];
            context.shadowBlur = node.hub ? 18 : 10;
          } else {
            context.shadowBlur = 0;
          }
          const fill = context.createRadialGradient(
            point.x - radius * 0.35,
            point.y - radius * 0.35,
            0,
            point.x,
            point.y,
            radius * 1.2,
          );
          fill.addColorStop(0, "#eafffb");
          fill.addColorStop(0.22, COLORS[node.type]);
          fill.addColorStop(1, `${COLORS[node.type]}88`);
          context.fillStyle = fill;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        }

        if (viewRef.current.scale >= 0.18) {
          const mobile = width < 640;
          const occupied: Array<{
            left: number;
            top: number;
            right: number;
            bottom: number;
          }> = [];
          const labeledNodes = layoutNodes
            .filter((node) =>
              shouldRenderGraphLabel({
                hub: node.hub,
                hovered: node.id === activeNodeId,
                labelsEnabled: labels,
                scale: viewRef.current.scale,
                mobile,
              }),
            )
            .sort(
              (a, b) =>
                Number(b.id === activeNodeId) -
                  Number(a.id === activeNodeId) ||
                Number(b.hub) - Number(a.hub) ||
                b.value - a.value,
            )
            .slice(0, mobile ? (viewRef.current.scale < 0.68 ? 12 : 20) : 48);

          for (const node of labeledNodes) {
            const point = screenPoint(node);
            const radius = Math.max(
              2.2,
              node.radius * Math.sqrt(viewRef.current.scale),
            );
            const labelLimit = mobile ? 18 : 26;
            const label =
              node.label.length > labelLimit
                ? `${node.label.slice(0, labelLimit - 2)}…`
                : node.label;
            const badge = TYPE_BADGES[node.type];
            const labelFont = `${mobile ? (node.hub ? 9 : 8) : node.hub ? 11 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
            context.font = labelFont;
            const labelWidth = context.measureText(label).width;
            context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
            const badgeWidth =
              context.measureText(badge.toUpperCase()).width + 8;
            const totalWidth = labelWidth + badgeWidth + 5;
            const labelHeight = 14;
            const above = {
              left: point.x - totalWidth / 2,
              top: point.y - radius - labelHeight - 5,
            };
            const below = {
              left: point.x - totalWidth / 2,
              top: point.y + radius + 5,
            };
            const right = {
              left: point.x + radius + 7,
              top: point.y - labelHeight / 2,
            };
            const left = {
              left: point.x - radius - totalWidth - 7,
              top: point.y - labelHeight / 2,
            };
            const candidates =
              node.type === "notebooks"
                ? [above, left, right, below]
                : node.type === "tags"
                  ? [below, right, left, above]
                  : [below, above, right, left];
            const expanded = [
              ...candidates,
              ...candidates.map((candidate) => ({
                ...candidate,
                top: candidate.top + 10,
              })),
              ...candidates.map((candidate) => ({
                ...candidate,
                top: candidate.top - 10,
              })),
            ];
            const box = expanded
              .map((candidate) =>
                clampGraphLabelBox(
                  candidate,
                  totalWidth,
                  labelHeight,
                  visibleViewport,
                ),
              )
              .find(
                (candidate) =>
                  occupied.every(
                    (existing) =>
                      candidate.right + 4 < existing.left ||
                      candidate.left - 4 > existing.right ||
                      candidate.bottom + 3 < existing.top ||
                      candidate.top - 3 > existing.bottom,
                  ),
              );
            if (!box) continue;
            occupied.push(box);

            const labelY = box.top + labelHeight / 2;
            const highlightOpacity = graphNodeOpacity(
              node.id,
              activeNodeId,
              activeNeighbors,
            );
            context.globalAlpha = highlightOpacity * (node.hub ? 0.94 : 0.76);
            context.textBaseline = "middle";
            context.textAlign = "left";
            context.font = labelFont;
            context.fillStyle = "#dffdf4";
            context.fillText(label, box.left, labelY);

            const badgeX = box.left + labelWidth + 5;
            const badgeY = labelY - 6;
            context.fillStyle = `${COLORS[node.type]}24`;
            context.strokeStyle = `${COLORS[node.type]}8f`;
            context.lineWidth = 0.75;
            context.beginPath();
            context.roundRect(badgeX, badgeY, badgeWidth, 12, 6);
            context.fill();
            context.stroke();
            context.fillStyle = COLORS[node.type];
            context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
            context.textAlign = "center";
            context.fillText(
              badge.toUpperCase(),
              badgeX + badgeWidth / 2,
              labelY + 0.5,
            );
          }
          canvas.dataset.renderedLabels = String(occupied.length);
        } else {
          canvas.dataset.renderedLabels = "0";
        }
        context.globalAlpha = 1;
        context.restore();
      });
    };

    const simulation = forceSimulation(layoutNodes)
      .force(
        "charge",
        forceManyBody<LayoutNode>().strength((node) =>
          node.type === "notebooks" ? -180 : node.hub ? -110 : -42,
        ),
      )
      .force(
        "link",
        forceLink<LayoutNode, LayoutEdge>(layoutEdges)
          .id((node) => node.id)
          .distance((edge) => (edge.signal === "notebook" ? 88 : 42))
          .strength((edge) => (edge.signal === "notebook" ? 0.12 : 0.28)),
      )
      .force(
        "collide",
        forceCollide<LayoutNode>()
          .radius((node) =>
            node.hub ? node.radius + 22 : node.radius + (labels ? 12 : 6),
          )
          .iterations(2),
      )
      .force(
        "lane-x",
        forceX<LayoutNode>((node) => laneOffset(node.type).x).strength(
          (node) => (node.hub ? 0.08 : 0.025),
        ),
      )
      .force(
        "lane-y",
        forceY<LayoutNode>((node) => laneOffset(node.type).y).strength(
          (node) => (node.hub ? 0.08 : 0.025),
        ),
      )
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.035)
      .on("tick", draw);

    const fit = () => {
      if (!layoutNodes.length) return;
      measureVisibleViewport();
      const xs = layoutNodes.map((node) => node.x ?? 0);
      const ys = layoutNodes.map((node) => node.y ?? 0);
      const graphPadding = 22;
      viewRef.current = calculateGraphFit({
        canvasWidth: width,
        canvasHeight: height,
        viewport: visibleViewport,
        graph: {
          left: Math.min(...xs) - graphPadding,
          top: Math.min(...ys) - graphPadding,
          right: Math.max(...xs) + graphPadding,
          bottom: Math.max(...ys) + graphPadding,
        },
      });
      canvas.dataset.graphFitScale = viewRef.current.scale.toFixed(3);
      canvas.dataset.graphStretchX = viewRef.current.stretchX.toFixed(2);
      canvas.dataset.graphStretchY = viewRef.current.stretchY.toFixed(2);
      draw();
    };

    const findNode = (clientX: number, clientY: number): LayoutNode | null => {
      const bounds = canvas.getBoundingClientRect();
      let nearest: LayoutNode | null = null;
      let nearestDistance = 22;
      for (const node of layoutNodes) {
        const point = screenPoint(node);
        const distance = Math.hypot(
          clientX - bounds.left - point.x,
          clientY - bounds.top - point.y,
        );
        if (distance < nearestDistance) {
          nearest = node;
          nearestDistance = distance;
        }
      }
      return nearest;
    };

    const showTooltip = (
      node: LayoutNode | null,
      clientX: number,
      clientY: number,
      touch: boolean,
    ) => {
      const bounds = canvas.getBoundingClientRect();
      const next = node
        ? {
            node,
            x: clientX - bounds.left,
            y: clientY - bounds.top,
            links: degree.get(node.id) ?? 0,
            touch,
          }
        : null;
      hoverRef.current = next;
      setHover(next);
      draw();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = Math.max(
        0.2,
        Math.min(3, viewRef.current.scale * Math.exp(-event.deltaY * 0.001)),
      );
      viewRef.current.scale = next;
      draw();
    };
    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        viewX: viewRef.current.x,
        viewY: viewRef.current.y,
        moved: false,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        drag.moved ||= Math.hypot(dx, dy) > 4;
        viewRef.current.x = drag.viewX + dx;
        viewRef.current.y = drag.viewY + dy;
        draw();
        return;
      }
      if (event.pointerType === "touch") return;
      const node = findNode(event.clientX, event.clientY);
      showTooltip(node, event.clientX, event.clientY, false);
      canvas.style.cursor = node ? "pointer" : "grab";
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.moved) {
        const node = findNode(event.clientX, event.clientY);
        const coarsePointer =
          event.pointerType === "touch" ||
          window.matchMedia("(pointer: coarse)").matches;
        if (node && coarsePointer && hoverRef.current?.node.id !== node.id) {
          showTooltip(node, event.clientX, event.clientY, true);
          return;
        }
        if (node) onNodeClick(node);
        else if (coarsePointer)
          showTooltip(null, event.clientX, event.clientY, true);
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    resize();
    const fitTimer = window.setTimeout(fit, 700);

    return () => {
      clearTimeout(fitTimer);
      resizeObserver.disconnect();
      simulation.stop();
      cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [degree, edges, fitVersion, focus, holo, labels, nodes, onNodeClick]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-testid="knowledge-graph"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        aria-label="Interactive knowledge graph"
      />
      <button
        type="button"
        onClick={() => setFitVersion((value) => value + 1)}
        className="hud-chip absolute left-3 top-[132px] z-30 inline-flex items-center gap-1.5 sm:top-24"
        aria-label="Fit graph to view"
      >
        <Maximize2 size={12} />
        Fit
      </button>
      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-56 rounded-lg border border-cyan-200/20 bg-[#07110f]/95 px-3 py-2 text-xs text-[#dffdf4] shadow-[0_0_24px_rgba(109,255,224,0.16)]"
          style={{
            left: Math.max(
              10,
              Math.min(
                hover.x + 14,
                Math.max(10, (containerRef.current?.clientWidth ?? 300) - 230),
              ),
            ),
            top: Math.max(10, hover.y - 42),
          }}
          role="tooltip"
          data-testid="graph-tooltip"
        >
          <p className="truncate font-medium">
            {hover.node.label} · {hover.links} links
          </p>
          <span className="mt-1 inline-flex rounded-full border border-cyan-100/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#8fd8c2]">
            {TYPE_BADGES[hover.node.type]}
          </span>
          {hover.touch && (
            <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#9fb4ab]">
              Tap again to open
            </p>
          )}
        </div>
      )}
    </div>
  );
}
