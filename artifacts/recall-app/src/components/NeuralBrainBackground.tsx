import { useEffect, useMemo, useRef } from "react";
import {
  buildMemoryGraph,
  projectParticles,
  type MemoryGraphInput,
  type ProjectedPoint,
} from "@/lib/neural-brain";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const fract = (value: number) => value - Math.floor(value);

type Props = {
  graph?: MemoryGraphInput;
  className?: string;
  /** Overall canvas opacity. */
  opacity?: number;
  /**
   * Glow / alpha strength (memory-network style).
   * Useful range ~0.6–1.1; default 0.8 for a calm app background.
   */
  intensity?: number;
  /**
   * Particle-budget multiplier.
   * Useful range ~0.6–1.3; default 0.9.
   */
  density?: number;
  /**
   * Animation speed multiplier.
   * Useful range ~0.5–1.1; default 0.7.
   */
  speed?: number;
  /**
   * Cursor drift + local repel. Keep off on input-heavy Ask Home.
   */
  interactive?: boolean;
  /** Scale the constellation to cover most of the viewport. */
  fillScreen?: boolean;
};

type RecallSignal = {
  a: number;
  b: number;
  offset: number;
  rate: number;
  size: number;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function prefersSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection;
  return Boolean(conn?.saveData);
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

type DisplayPoint = ProjectedPoint & { dx: number; dy: number };

/**
 * Push triangles away from the cursor. Synapses always draw between these
 * displaced positions, so connections stay attached while nodes move aside.
 */
function withCursorRepel(
  projected: ProjectedPoint[],
  width: number,
  height: number,
  cursor: { x: number; y: number; active: boolean },
): DisplayPoint[] {
  const repelR = Math.min(width, height) * 0.14;
  const repelR2 = repelR * repelR;
  const maxPush = repelR * 0.7;

  return projected.map((pt) => {
    let dx = 0;
    let dy = 0;
    if (cursor.active) {
      const ox = pt.x - cursor.x;
      const oy = pt.y - cursor.y;
      const d2 = ox * ox + oy * oy;
      if (d2 < repelR2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const falloff = 1 - d / repelR;
        const push = falloff * falloff * maxPush;
        dx = (ox / d) * push;
        dy = (oy / d) * push;
      } else if (d2 <= 0.0001) {
        dy = -maxPush;
      }
    }
    return { ...pt, dx, dy };
  });
}

function buildRecallSignals(
  synapseCount: number,
  particleCount: number,
): RecallSignal[] {
  if (synapseCount === 0 || particleCount < 2) return [];
  const signalCount = clamp(Math.round(particleCount / 220), 3, 8);
  const signals: RecallSignal[] = [];
  for (let i = 0; i < signalCount; i += 1) {
    signals.push({
      a: i % particleCount,
      b: (i * 7 + 3) % particleCount,
      offset: (i * 0.137) % 1,
      rate: 0.055 + (i % 5) * 0.011,
      size: 1 + (i % 3) * 0.35,
    });
  }
  return signals;
}

function drawRecallSignals(
  ctx: CanvasRenderingContext2D,
  byIndex: DisplayPoint[],
  synapses: { a: number; b: number; strength: number }[],
  signals: RecallSignal[],
  time: number,
  intensity: number,
  fillScreen: boolean,
) {
  if (signals.length === 0 || byIndex.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = fillScreen ? "source-over" : "lighter";

  for (let i = 0; i < signals.length; i += 1) {
    const signal = signals[i]!;
    // Prefer a real synapse edge when available so pulses travel along links.
    const syn = synapses[i % Math.max(1, synapses.length)];
    const aIdx = syn?.a ?? signal.a;
    const bIdx = syn?.b ?? signal.b;
    const a = byIndex[aIdx % byIndex.length];
    const b = byIndex[bIdx % byIndex.length];
    if (!a || !b) continue;

    const ax = a.x + a.dx;
    const ay = a.y + a.dy;
    const bx = b.x + b.dx;
    const by = b.y + b.dy;
    const progress = fract(time * signal.rate + signal.offset);
    const fade = Math.sin(progress * Math.PI);
    const x = ax + (bx - ax) * progress;
    const y = ay + (by - ay) * progress;
    const radius = signal.size * (0.7 + fade * 0.55);

    // Teal accent every third pulse; otherwise indigo — matches Recall palette.
    const hue = i % 3 === 0 ? 168 : 250;
    ctx.globalAlpha = fade * 0.55 * intensity;
    ctx.fillStyle = `hsla(${hue}, 85%, 68%, 1)`;
    ctx.shadowColor = `hsla(${hue}, 90%, 70%, 0.9)`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  projected: ProjectedPoint[],
  synapses: { a: number; b: number; strength: number }[],
  signals: RecallSignal[],
  time: number,
  intensity: number,
  fillScreen: boolean,
  cursor: { x: number; y: number; active: boolean },
) {
  ctx.clearRect(0, 0, width, height);

  const boost = intensity;
  const additive = !fillScreen;

  const glow = ctx.createRadialGradient(
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    10,
    width * (fillScreen ? 0.5 : 0.58),
    height * (fillScreen ? 0.46 : 0.42),
    Math.min(width, height) * (fillScreen ? 0.55 : 0.4),
  );
  glow.addColorStop(
    0,
    fillScreen
      ? `rgba(120, 90, 230, ${0.22 * intensity})`
      : `rgba(128, 82, 255, ${0.1 * intensity})`,
  );
  glow.addColorStop(
    0.45,
    fillScreen
      ? `rgba(40, 160, 140, ${0.1 * intensity})`
      : `rgba(21, 132, 110, ${0.04 * intensity})`,
  );
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const byIndex = withCursorRepel(projected, width, height, cursor);

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
        fillScreen ? 0.28 : 0.2,
        s.strength * (0.55 - depth * 0.12) * (fillScreen ? 1.05 : 1) * boost,
      ),
    );
    const pulse = 0.8 + 0.2 * Math.sin(time * 1.6 + s.a * 0.05);
    const ax = a.x + a.dx;
    const ay = a.y + a.dy;
    const bx = b.x + b.dx;
    const by = b.y + b.dy;
    const nudged =
      Math.abs(a.dx) + Math.abs(a.dy) + Math.abs(b.dx) + Math.abs(b.dy) > 0.5;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = fillScreen
      ? `hsla(${nudged ? 280 : 265}, ${nudged ? 85 : 75}%, ${nudged ? 76 : 72}%, ${alpha * pulse * (nudged ? 1.2 : 1)})`
      : `hsla(265, 80%, 72%, ${alpha * pulse})`;
    ctx.lineWidth =
      a.particle.kind === "entity" || b.particle.kind === "entity"
        ? 1.15
        : fillScreen
          ? nudged
            ? 0.9
            : 0.75
          : 0.55;
    ctx.stroke();
  }
  ctx.restore();

  drawRecallSignals(ctx, byIndex, synapses, signals, time, intensity, fillScreen);

  ctx.save();
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  for (const pt of byIndex) {
    const { particle: p } = pt;
    const x = pt.x + pt.dx;
    const y = pt.y + pt.dy;
    const depthFade = Math.max(0.35, Math.min(1, 0.85 - pt.depth * 0.28));
    const twinkle =
      p.kind === "entity"
        ? 0.8 + 0.2 * Math.sin(time * 2.2 + p.phase)
        : 0.65 + 0.35 * Math.sin(time * 1.7 + p.phase);
    const size =
      p.size *
      (p.kind === "entity" ? 1.35 : fillScreen ? 1.12 : 1) *
      Math.max(0.55, 1 - pt.depth * 0.25) *
      (window.devicePixelRatio > 1.5 ? 0.9 : 1);
    const alpha =
      (p.kind === "entity" ? 0.7 : fillScreen ? 0.88 : 0.28) *
      depthFade *
      twinkle *
      intensity;

    if (p.kind === "entity" || (fillScreen && size > 1.8)) {
      ctx.beginPath();
      ctx.arc(x, y, size * (p.kind === "entity" ? 2.4 : 1.9), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha * (p.kind === "entity" ? 0.24 : 0.16)})`;
      ctx.fill();
    }

    drawTriangle(
      ctx,
      x,
      y,
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
 * Tunable density/speed/intensity and traveling recall signals (ported from
 * the memory-network Web Component patterns) without losing brainGraph data.
 */
export function NeuralBrainBackground({
  graph,
  className = "",
  opacity = 0.42,
  intensity: intensityProp = 0.8,
  density: densityProp = 0.9,
  speed: speedProp = 0.7,
  interactive = false,
  fillScreen = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftRef = useRef({ rotY: 0, rotX: 0, velY: 0, velX: 0 });
  const cursorRef = useRef({ x: 0, y: 0, active: false, movedAt: 0 });
  const lastPointerRef = useRef({ x: 0, y: 0, t: 0 });
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const saveData = useMemo(() => prefersSaveData(), []);
  const staticFrame = reduced || saveData;

  const intensity = clamp(intensityProp, 0.35, 1.6);
  const density = clamp(densityProp, 0.35, 1.8);
  const speed = clamp(speedProp, 0.15, 2.5);

  const { particles, synapses, signals } = useMemo(() => {
    const mobileFactor = isMobileViewport() ? 0.72 : 1;
    const base = isMobileViewport()
      ? fillScreen
        ? 900
        : 550
      : staticFrame
        ? 900
        : fillScreen
          ? 1400
          : 1200;
    const count = clamp(Math.round(base * density * mobileFactor), 200, 1800);
    const built = buildMemoryGraph(graph ?? {}, count, fillScreen);
    const signals = buildRecallSignals(built.synapses.length, built.particles.length);
    return { ...built, signals };
  }, [graph, staticFrame, fillScreen, density]);

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
      // Cap DPR at 1.75 (memory-network production hardening).
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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
      if (!interactive || staticFrame) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const now = performance.now();
      const prev = lastPointerRef.current;
      let moving = false;
      if (prev.t > 0) {
        const dx = (x - prev.x) / Math.max(1, rect.width);
        const dy = (y - prev.y) / Math.max(1, rect.height);
        const pointerSpeed = Math.hypot(dx, dy);
        moving = pointerSpeed > 0.0005;
        if (moving) {
          const drift = driftRef.current;
          drift.velY += dx * 1.8;
          drift.velX += dy * 1.1;
          drift.velY = Math.max(-1.2, Math.min(1.2, drift.velY));
          drift.velX = Math.max(-0.7, Math.min(0.7, drift.velX));
        }
      }
      lastPointerRef.current = { x, y, t: now };
      cursorRef.current = {
        x,
        y,
        active: moving,
        movedAt: moving ? now : cursorRef.current.movedAt,
      };
    };

    const onPointerLeave = () => {
      cursorRef.current = { x: 0, y: 0, active: false, movedAt: 0 };
      lastPointerRef.current.t = 0;
    };

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running && !staticFrame) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    if (interactive && !staticFrame) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    const paint = (now: number, animate: boolean) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const time = animate ? ((now - start) / 1000) * speed : 0;

      if (animate && interactive) {
        const drift = driftRef.current;
        drift.rotY += drift.velY * dt;
        drift.rotX += drift.velX * dt;
        drift.rotX *= 0.995;
        drift.velY *= 0.88;
        drift.velX *= 0.85;
        if (Math.abs(drift.velY) < 0.003) drift.velY = 0;
        if (Math.abs(drift.velX) < 0.003) drift.velX = 0;
      }

      const cursor = cursorRef.current;
      const repelling =
        interactive &&
        cursor.active &&
        cursor.movedAt > 0 &&
        now - cursor.movedAt < 140;
      const projected = projectParticles(
        particles,
        w,
        h,
        time,
        {
          rotY: interactive ? driftRef.current.rotY : 0,
          rotX: interactive ? driftRef.current.rotX : 0,
        },
        fillScreen,
      );
      renderFrame(
        ctx,
        w,
        h,
        projected,
        synapses,
        signals,
        time,
        intensity,
        fillScreen,
        { x: cursor.x, y: cursor.y, active: repelling },
      );
    };

    const tick = (now: number) => {
      if (!running) return;
      paint(now, true);
      raf = requestAnimationFrame(tick);
    };

    if (staticFrame) {
      paint(performance.now(), false);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    particles,
    synapses,
    signals,
    staticFrame,
    intensity,
    speed,
    interactive,
    fillScreen,
  ]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
      style={{ opacity, contain: "strict" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#060610]/15 via-transparent to-[#060610]/40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(6,6,16,0.18)_100%)]" />
    </div>
  );
}
