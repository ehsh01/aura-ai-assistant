import { useEffect, useMemo, useRef } from "react";
import {
  buildMemoryGraph,
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
    ctx.fillStyle = `hsla(${hue}, 85%, 68%, ${alpha})`;
    ctx.fill();
  } else {
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${alpha})`;
    ctx.lineWidth = Math.max(0.6, size * 0.22);
    ctx.stroke();
  }
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  projected: ProjectedPoint[],
  synapses: { a: number; b: number; strength: number }[],
  time: number,
  vivid: boolean,
  fillScreen: boolean,
) {
  ctx.clearRect(0, 0, width, height);

  const boost = vivid ? 2.6 : 1;

  const glow = ctx.createRadialGradient(
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    10,
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    Math.min(width, height) * (fillScreen ? 0.62 : 0.4),
  );
  glow.addColorStop(0, vivid ? "rgba(148, 110, 255, 0.45)" : "rgba(128, 82, 255, 0.10)");
  glow.addColorStop(0.4, vivid ? "rgba(56, 189, 160, 0.2)" : "rgba(21, 132, 110, 0.04)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const byIndex = projected;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of synapses) {
    const a = byIndex[s.a];
    const b = byIndex[s.b];
    if (!a || !b) continue;
    const depth = (a.depth + b.depth) * 0.5;
    const alpha = Math.max(
      0.02,
      Math.min(vivid ? 0.62 : 0.22, s.strength * (0.55 - depth * 0.15) * boost),
    );
    const pulse = 0.65 + 0.35 * Math.sin(time * 1.6 + s.a * 0.05);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `hsla(265, 85%, 78%, ${alpha * pulse})`;
    ctx.lineWidth =
      a.particle.kind === "entity" || b.particle.kind === "entity"
        ? vivid
          ? 1.7
          : 1.1
        : vivid
          ? 1.05
          : 0.55;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const pt of projected) {
    const { particle: p } = pt;
    const depthFade = Math.max(0.2, Math.min(1, 0.85 - pt.depth * 0.3));
    const twinkle =
      p.kind === "entity"
        ? 0.8 + 0.2 * Math.sin(time * 2.2 + p.phase)
        : 0.6 + 0.4 * Math.sin(time * 1.7 + p.phase);
    const size =
      p.size *
      (p.kind === "entity" ? (vivid ? 1.75 : 1.35) : 1) *
      Math.max(0.55, 1 - pt.depth * 0.25) *
      (window.devicePixelRatio > 1.5 ? 0.9 : 1) *
      (vivid ? 1.25 : 1);
    const alpha =
      (p.kind === "entity" ? (vivid ? 1 : 0.55) : vivid ? 0.72 : 0.28) *
      depthFade *
      twinkle;

    if (p.kind === "entity" || size > 1.6) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size * (vivid ? 3.8 : 2.4), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${alpha * (vivid ? 0.4 : 0.18)})`;
      ctx.fill();
    }

    drawTriangle(ctx, pt.x, pt.y, size, p.hue, Math.min(1, alpha), p.kind === "entity");
  }
  ctx.restore();
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
        ? 1100
        : 700
      : reduced
        ? 1200
        : fillScreen
          ? 2200
          : 1600;
    return buildMemoryGraph(graph ?? {}, count, fillScreen);
  }, [graph, reduced, fillScreen]);

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
      renderFrame(ctx, w, h, projected, synapses, time, vivid, fillScreen);
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
  }, [particles, synapses, reduced, vivid, fillScreen]);

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
