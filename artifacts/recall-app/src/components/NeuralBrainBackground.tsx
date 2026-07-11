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
    ctx.strokeStyle = `hsla(${hue}, 90%, 72%, ${alpha})`;
    ctx.lineWidth = Math.max(0.7, size * 0.22);
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
  /** Cursor in canvas CSS pixels; only synapses near this get disturbed. */
  cursor: { x: number; y: number; active: boolean },
) {
  ctx.clearRect(0, 0, width, height);

  const boost = vivid ? 1.7 : 1;
  // Home fillScreen: avoid "lighter" — overlapping synapses stack to pure white.
  const additive = !fillScreen;

  const glow = ctx.createRadialGradient(
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    10,
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    Math.min(width, height) * (fillScreen ? 0.55 : 0.4),
  );
  glow.addColorStop(0, vivid ? "rgba(128, 82, 255, 0.22)" : fillScreen ? "rgba(120, 90, 230, 0.28)" : "rgba(128, 82, 255, 0.10)");
  glow.addColorStop(0.45, vivid ? "rgba(21, 132, 110, 0.1)" : fillScreen ? "rgba(40, 160, 140, 0.12)" : "rgba(21, 132, 110, 0.04)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const byIndex = projected;
  // Local disturbance radius — only connections the cursor touches.
  const disturbR = Math.min(width, height) * 0.11;
  const disturbR2 = disturbR * disturbR;

  ctx.save();
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  for (const s of synapses) {
    const a = byIndex[s.a];
    const b = byIndex[s.b];
    if (!a || !b) continue;
    const depth = (a.depth + b.depth) * 0.5;
    const alpha = Math.max(
      0.04,
      Math.min(
        vivid ? 0.38 : fillScreen ? 0.28 : 0.2,
        s.strength * (0.55 - depth * 0.12) * (fillScreen ? 1.05 : boost),
      ),
    );
    const pulse = 0.8 + 0.2 * Math.sin(time * 1.6 + s.a * 0.05);

    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    let cpx = (ax + bx) * 0.5;
    let cpy = (ay + by) * 0.5;
    let disturbed = false;

    if (cursor.active) {
      const mx = cursor.x;
      const my = cursor.y;
      // Distance from cursor to the segment (closest point).
      const abx = bx - ax;
      const aby = by - ay;
      const apx = mx - ax;
      const apy = my - ay;
      const abLen2 = abx * abx + aby * aby || 1;
      let t = (apx * abx + apy * aby) / abLen2;
      t = Math.max(0, Math.min(1, t));
      const closestX = ax + abx * t;
      const closestY = ay + aby * t;
      const dx = closestX - mx;
      const dy = closestY - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < disturbR2) {
        disturbed = true;
        const d = Math.sqrt(d2) || 0.0001;
        const falloff = 1 - d / disturbR;
        const push = falloff * falloff * disturbR * 0.55;
        // Push the line away from the cursor along the radial direction.
        const nx = dx / d;
        const ny = dy / d;
        const endPush = push * 0.35;
        ax += nx * endPush * (1 - t);
        ay += ny * endPush * (1 - t);
        bx += nx * endPush * t;
        by += ny * endPush * t;
        cpx = closestX + nx * push;
        cpy = closestY + ny * push;
      }
    }

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    if (disturbed) {
      ctx.quadraticCurveTo(cpx, cpy, bx, by);
    } else {
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = fillScreen
      ? `hsla(${disturbed ? 280 : 265}, ${disturbed ? 90 : 75}%, ${disturbed ? 78 : 72}%, ${alpha * pulse * (disturbed ? 1.35 : 1)})`
      : `hsla(265, 80%, 72%, ${alpha * pulse})`;
    ctx.lineWidth =
      a.particle.kind === "entity" || b.particle.kind === "entity"
        ? 1.15
        : fillScreen
          ? disturbed
            ? 1.05
            : 0.75
          : 0.55;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  for (const pt of projected) {
    const { particle: p } = pt;
    const depthFade = Math.max(0.35, Math.min(1, 0.85 - pt.depth * 0.28));
    const twinkle =
      p.kind === "entity"
        ? 0.8 + 0.2 * Math.sin(time * 2.2 + p.phase)
        : 0.65 + 0.35 * Math.sin(time * 1.7 + p.phase);
    const size =
      p.size *
      (p.kind === "entity" ? (vivid ? 1.55 : 1.35) : fillScreen ? 1.12 : 1) *
      Math.max(0.55, 1 - pt.depth * 0.25) *
      (window.devicePixelRatio > 1.5 ? 0.9 : 1) *
      (vivid ? 1.1 : 1);
    const alpha =
      (p.kind === "entity" ? (vivid ? 0.75 : 0.7) : vivid ? 0.42 : fillScreen ? 0.88 : 0.28) *
      depthFade *
      twinkle;

    // Soft colored dots — kept modest so they don't stack to white.
    if (p.kind === "entity" || (fillScreen && size > 1.8)) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size * (p.kind === "entity" ? 2.4 : 1.9), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha * (p.kind === "entity" ? 0.24 : 0.16)})`;
      ctx.fill();
    }

    drawTriangle(
      ctx,
      pt.x,
      pt.y,
      size,
      p.hue,
      Math.min(fillScreen ? 0.92 : 0.85, alpha),
      p.kind === "entity",
    );
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
  /** Continuous drift from mouse movement (keeps going in that direction). */
  const driftRef = useRef({ rotY: 0, rotX: 0, velY: 0, velX: 0 });
  const cursorRef = useRef({ x: 0, y: 0, active: false, movedAt: 0 });
  const lastPointerRef = useRef({ x: 0, y: 0, t: 0 });
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
          ? 1800
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
    let lastFrame = start;
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
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = performance.now();
      const prev = lastPointerRef.current;
      let moving = false;
      if (prev.t > 0) {
        const dx = (x - prev.x) / Math.max(1, rect.width);
        const dy = (y - prev.y) / Math.max(1, rect.height);
        const speed = Math.hypot(dx, dy);
        moving = speed > 0.0005;
        if (moving) {
          const drift = driftRef.current;
          drift.velY += dx * 1.8;
          drift.velX += dy * 1.1;
          drift.velY = Math.max(-1.2, Math.min(1.2, drift.velY));
          drift.velX = Math.max(-0.7, Math.min(0.7, drift.velX));
        }
      }
      lastPointerRef.current = { x, y, t: now };
      // Disturb synapses only while the mouse is moving — stop = leave the brain alone.
      cursorRef.current = { x, y, active: moving, movedAt: moving ? now : cursorRef.current.movedAt };
    };

    const onPointerLeave = () => {
      cursorRef.current = { x: 0, y: 0, active: false, movedAt: 0 };
      lastPointerRef.current.t = 0;
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) {
        start = performance.now() - (performance.now() - start);
        lastFrame = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    const tick = (now: number) => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const time = reduced ? 0 : (now - start) / 1000;

      // Integrate mouse-driven velocity; settle fast when the mouse stops.
      if (!reduced) {
        const drift = driftRef.current;
        drift.rotY += drift.velY * dt;
        drift.rotX += drift.velX * dt;
        drift.rotX *= 0.995;
        drift.velY *= 0.88;
        drift.velX *= 0.85;
        if (Math.abs(drift.velY) < 0.003) drift.velY = 0;
        if (Math.abs(drift.velX) < 0.003) drift.velX = 0;
      }

      // Local bend only during recent movement — idle cursor leaves the mesh alone.
      const cursor = cursorRef.current;
      const disturb =
        cursor.active && cursor.movedAt > 0 && now - cursor.movedAt < 120;
      const projected = projectParticles(
        particles,
        w,
        h,
        time,
        { rotY: driftRef.current.rotY, rotX: driftRef.current.rotX },
        fillScreen,
      );
      renderFrame(ctx, w, h, projected, synapses, time, vivid, fillScreen, {
        x: cursor.x,
        y: cursor.y,
        active: disturb,
      });
      if (!reduced) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerleave", onPointerLeave);
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
      <div className="absolute inset-0 bg-gradient-to-b from-[#060610]/15 via-transparent to-[#060610]/40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(6,6,16,0.18)_100%)]" />
    </div>
  );
}
