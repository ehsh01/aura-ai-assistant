import { useEffect, useMemo, useRef } from "react";
import {
  buildBrainOutlinePoints,
  buildMemoryGraph,
  projectBrainOutline,
  projectParticles,
  type MemoryGraphInput,
  type ProjectedPoint,
} from "@/lib/neural-brain";

type Props = {
  graph?: MemoryGraphInput;
  className?: string;
  /** Overall canvas opacity. */
  opacity?: number;
  /** Brighter particles/synapses (Home oracle). */
  intensity?: "normal" | "vivid";
  /** Scale the constellation to cover most of the viewport. */
  fillScreen?: boolean;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  hue: number,
  alpha: number,
  filled: boolean,
) {
  const h = size;
  const w = size * 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + w, y + h * 0.55);
  ctx.lineTo(x - w, y + h * 0.55);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = `hsla(${hue}, 90%, 78%, ${alpha})`;
    ctx.fill();
  } else {
    ctx.strokeStyle = `hsla(${hue}, 95%, 80%, ${alpha})`;
    ctx.lineWidth = Math.max(1.1, size * 0.28);
    ctx.stroke();
  }
}

function drawBrainOutline(
  ctx: CanvasRenderingContext2D,
  path: { x: number; y: number }[],
  time: number,
  vivid: boolean,
  mode: "glow" | "edge" | "full" = "full",
) {
  if (path.length < 8) return;

  const pulse = 0.85 + 0.15 * Math.sin(time * 1.3);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(path[0]!.x, path[0]!.y);
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!;
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (mode === "glow" || mode === "full") {
    ctx.strokeStyle = `hsla(265, 90%, 78%, ${(vivid ? 0.4 : 0.2) * pulse})`;
    ctx.lineWidth = vivid ? 12 : 7;
    ctx.stroke();
    ctx.strokeStyle = `hsla(200, 90%, 75%, ${(vivid ? 0.5 : 0.25) * pulse})`;
    ctx.lineWidth = vivid ? 4.5 : 2.8;
    ctx.stroke();
  }

  if (mode === "edge" || mode === "full") {
    ctx.strokeStyle = `hsla(270, 100%, 94%, ${(vivid ? 1 : 0.6) * pulse})`;
    ctx.lineWidth = vivid ? 1.75 : 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  projected: ProjectedPoint[],
  synapses: { a: number; b: number; strength: number }[],
  outlinePath: { x: number; y: number }[],
  time: number,
  vivid: boolean,
  fillScreen: boolean,
) {
  ctx.clearRect(0, 0, width, height);

  const boost = vivid ? 3.2 : 1;

  const glow = ctx.createRadialGradient(
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    10,
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    Math.min(width, height) * (fillScreen ? 0.7 : 0.4),
  );
  glow.addColorStop(0, vivid ? "rgba(168, 130, 255, 0.55)" : "rgba(128, 82, 255, 0.10)");
  glow.addColorStop(0.35, vivid ? "rgba(56, 189, 160, 0.28)" : "rgba(21, 132, 110, 0.04)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Draw outline first so particles sit inside a readable cortex edge.
  if (fillScreen || vivid) {
    drawBrainOutline(ctx, outlinePath, time, vivid, "glow");
  }

  const byIndex = projected;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of synapses) {
    const a = byIndex[s.a];
    const b = byIndex[s.b];
    if (!a || !b) continue;
    const depth = (a.depth + b.depth) * 0.5;
    const alpha = Math.max(
      0.04,
      Math.min(vivid ? 0.85 : 0.22, s.strength * (0.7 - depth * 0.12) * boost),
    );
    const pulse = 0.7 + 0.3 * Math.sin(time * 1.6 + s.a * 0.05);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `hsla(265, 90%, 82%, ${alpha * pulse})`;
    ctx.lineWidth =
      a.particle.kind === "entity" || b.particle.kind === "entity"
        ? vivid
          ? 2.2
          : 1.1
        : vivid
          ? fillScreen
            ? 1.55
            : 1.15
          : 0.55;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const pt of projected) {
    const { particle: p } = pt;
    const depthFade = Math.max(0.35, Math.min(1, 0.95 - pt.depth * 0.25));
    const twinkle =
      p.kind === "entity"
        ? 0.85 + 0.15 * Math.sin(time * 2.2 + p.phase)
        : 0.7 + 0.3 * Math.sin(time * 1.7 + p.phase);
    const size =
      p.size *
      (p.kind === "entity" ? (vivid ? 2.1 : 1.35) : fillScreen && vivid ? 1.35 : 1) *
      Math.max(0.65, 1 - pt.depth * 0.2) *
      (window.devicePixelRatio > 1.5 ? 0.95 : 1) *
      (vivid ? 1.45 : 1);
    const alpha =
      (p.kind === "entity" ? (vivid ? 1 : 0.55) : vivid ? 0.95 : 0.28) *
      depthFade *
      twinkle;

    if (p.kind === "entity" || size > 1.4) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size * (vivid ? 4.2 : 2.4), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 72%, ${alpha * (vivid ? 0.5 : 0.18)})`;
      ctx.fill();
    }

    drawTriangle(ctx, pt.x, pt.y, size, p.hue, Math.min(1, alpha), p.kind === "entity");
  }
  ctx.restore();

  // Redraw a crisp edge on top so particles don't erase the silhouette.
  if (fillScreen || vivid) {
    drawBrainOutline(ctx, outlinePath, time, vivid, "edge");
  }
}

/**
 * Dala-inspired neural constellation: triangular particles forming a brain,
 * with synapses linking ambient points and real Recall memory entities.
 */
export function NeuralBrainBackground({
  graph,
  className = "",
  opacity = 0.42,
  intensity = "normal",
  fillScreen = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const vivid = intensity === "vivid";

  const { particles, synapses } = useMemo(() => {
    const count = isMobileViewport()
      ? fillScreen
        ? 1400
        : 700
      : reduced
        ? 1400
        : fillScreen
          ? 2800
          : 1600;
    return buildMemoryGraph(graph ?? {}, count, fillScreen);
  }, [graph, reduced, fillScreen]);

  const outlinePoints = useMemo(
    () => buildBrainOutlinePoints(fillScreen ? 260 : 160, fillScreen),
    [fillScreen],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let start = performance.now();
    const parent = canvas.parentElement;

    const resize = () => {
      const rect = parent?.getBoundingClientRect() ?? {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (parent) ro.observe(parent);

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
      };
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) {
        start = performance.now() - (performance.now() - start);
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    const tick = (now: number) => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const time = reduced ? 0 : (now - start) / 1000;
      const projected = projectParticles(
        particles,
        w,
        h,
        time,
        pointerRef.current,
        fillScreen,
      );
      const outlinePath = projectBrainOutline(
        outlinePoints,
        w,
        h,
        time,
        pointerRef.current,
        fillScreen,
      );
      renderFrame(ctx, w, h, projected, synapses, outlinePath, time, vivid, fillScreen);
      if (!reduced) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [particles, synapses, outlinePoints, reduced, vivid, fillScreen]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
      style={{ opacity }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {vivid ? null : (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-[#060610]/30 via-transparent to-[#060610]/55" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(6,6,16,0.35)_100%)]" />
        </>
      )}
    </div>
  );
}
