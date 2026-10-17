import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Maximize2 } from "lucide-react";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
} from "@/lib/recall-api";

type LayoutNode = KnowledgeGraphNode &
  SimulationNodeDatum & {
    radius: number;
  };
type LayoutEdge = SimulationLinkDatum<LayoutNode> & KnowledgeGraphEdge;

const COLORS: Record<KnowledgeGraphNodeType, string> = {
  notes: "#75baff",
  notebooks: "#6dffe0",
  tags: "#f5ca62",
  links: "#b695ff",
  files: "#ff8f82",
  evernote: "#74e59b",
};

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
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
    moved: boolean;
  } | null>(null);
  const [hover, setHover] = useState<{
    node: KnowledgeGraphNode;
    x: number;
    y: number;
    links: number;
  } | null>(null);
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

    const layoutNodes: LayoutNode[] = nodes.map((node) => ({
      ...node,
      radius: Math.max(3, Math.min(node.hub ? 13 : 9, node.value)),
    }));
    const nodeIds = new Set(layoutNodes.map((node) => node.id));
    const layoutEdges: LayoutEdge[] = edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ ...edge }));
    layoutRef.current = { nodes: layoutNodes, edges: layoutEdges };

    let width = container.clientWidth;
    let height = container.clientHeight;
    let frame = 0;
    const context = canvas.getContext("2d");
    if (!context) return;

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };

    const screenPoint = (node: LayoutNode) => ({
      x: width / 2 + viewRef.current.x + (node.x ?? 0) * viewRef.current.scale,
      y: height / 2 + viewRef.current.y + (node.y ?? 0) * viewRef.current.scale,
    });

    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        context.clearRect(0, 0, width, height);
        context.save();
        context.lineWidth = focus ? 0.55 : 0.75;
        for (const edge of layoutEdges) {
          const source = edge.source as LayoutNode;
          const target = edge.target as LayoutNode;
          if (typeof source !== "object" || typeof target !== "object") continue;
          const from = screenPoint(source);
          const to = screenPoint(target);
          const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
          gradient.addColorStop(0, `${COLORS[source.type]}55`);
          gradient.addColorStop(1, `${COLORS[target.type]}32`);
          context.strokeStyle = gradient;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }

        for (const node of layoutNodes) {
          const point = screenPoint(node);
          const radius = Math.max(2.2, node.radius * Math.sqrt(viewRef.current.scale));
          context.globalAlpha = focus && !node.hub ? 0.72 : 1;
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

          if ((node.hub || labels) && viewRef.current.scale > 0.48) {
            context.globalAlpha = node.hub ? 0.94 : 0.72;
            context.fillStyle = "#dffdf4";
            context.font = `${node.hub ? 11 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
            context.textAlign = "center";
            context.fillText(
              node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label,
              point.x,
              point.y + radius + 13,
            );
          }
        }
        context.globalAlpha = 1;
        context.restore();
      });
    };

    const simulation = forceSimulation(layoutNodes)
      .force("charge", forceManyBody<LayoutNode>().strength((node) => (node.hub ? -90 : -35)))
      .force(
        "link",
        forceLink<LayoutNode, LayoutEdge>(layoutEdges)
          .id((node) => node.id)
          .distance((edge) => (edge.signal === "notebook" ? 54 : 42))
          .strength(0.28),
      )
      .force("collide", forceCollide<LayoutNode>().radius((node) => node.radius + 5))
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.035)
      .on("tick", draw);

    const fit = () => {
      if (!layoutNodes.length) return;
      const xs = layoutNodes.map((node) => node.x ?? 0);
      const ys = layoutNodes.map((node) => node.y ?? 0);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const graphWidth = Math.max(1, maxX - minX);
      const graphHeight = Math.max(1, maxY - minY);
      const scale = Math.max(
        0.25,
        Math.min(1.3, Math.min((width - 80) / graphWidth, (height - 110) / graphHeight)),
      );
      viewRef.current = {
        scale,
        x: -((minX + maxX) / 2) * scale,
        y: -((minY + maxY) / 2) * scale,
      };
      draw();
    };

    const findNode = (clientX: number, clientY: number): LayoutNode | null => {
      const bounds = canvas.getBoundingClientRect();
      let nearest: LayoutNode | null = null;
      let nearestDistance = 22;
      for (const node of layoutNodes) {
        const point = screenPoint(node);
        const distance = Math.hypot(clientX - bounds.left - point.x, clientY - bounds.top - point.y);
        if (distance < nearestDistance) {
          nearest = node;
          nearestDistance = distance;
        }
      }
      return nearest;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = Math.max(0.2, Math.min(3, viewRef.current.scale * Math.exp(-event.deltaY * 0.001)));
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
      const node = findNode(event.clientX, event.clientY);
      const bounds = canvas.getBoundingClientRect();
      setHover(
        node
          ? {
              node,
              x: event.clientX - bounds.left,
              y: event.clientY - bounds.top,
              links: degree.get(node.id) ?? 0,
            }
          : null,
      );
      canvas.style.cursor = node ? "pointer" : "grab";
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.moved) {
        const node = findNode(event.clientX, event.clientY);
        if (node) onNodeClick(node);
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
    <div ref={containerRef} className="relative h-full w-full" data-testid="knowledge-graph">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="Interactive knowledge graph" />
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
          style={{ left: Math.min(hover.x + 14, 260), top: Math.max(10, hover.y - 42) }}
          role="tooltip"
        >
          <p className="truncate font-medium">{hover.node.label}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8fd8c2]">
            {hover.node.type} · {hover.links} links
          </p>
        </div>
      )}
    </div>
  );
}
