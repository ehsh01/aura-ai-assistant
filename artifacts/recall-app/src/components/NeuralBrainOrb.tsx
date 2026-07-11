import { useEffect, useMemo, useRef } from "react";
import {
  buildAmbientCloud,
  projectParticles,
  type BrainSynapse,
} from "@/lib/neural-brain";

type Props = {
  className?: string;
  /** Show a brighter pulse while Ask is pending. */
  active?: boolean;
  size?: number;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function buildMiniSynapses(
  count: number,
): { particles: ReturnType<typeof buildAmbientCloud>; synapses: BrainSynapse[] } {
  const particles = buildAmbientCloud(count, false).map((p) => ({
    ...p,
    // Larger nodes so they read inside a ~40px circle.
    size: 1.4 + p.size * 0.9,
  }));
  const synapses: BrainSynapse[] = [];
  const step = 1;
  for (let i = 0; i < particles.length; i += step) {
    const a = particles[i]!;
    let best = -1;
    let bestD = 0.18;
    for (let j = i + 1; j < Math.min(particles.length, i + 30); j++) {
      const b = particles[j]!;
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) synapses.push({ a: i, b: best, strength: 0.45 });
  }
  return { particles, synapses };
}

/**
 * Tiny spinning neural-brain orb for the Ask prompt icon slot.
 */
export function NeuralBrainOrb({ className = "", active = false, size = 40 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const { particles, synapses } = useMemo(() => buildMiniSynapses(reduced ? 60 : 110), [reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(size * dpr));
      canvas.height = Math.max(1, Math.floor(size * dpr));
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const tick = (now: number) => {
      if (!running) return;
      const time = reduced ? 0 : (now - start) / 1000;
      // Centered fillScreen projection; time boost so the tiny orb still spins clearly.
      const projected = projectParticles(
        particles,
        size,
        size,
        time * 2.8,
        { rotY: 0, rotX: 0 },
        true,
      );

      ctx.clearRect(0, 0, size, size);

      // Solid dark base so the mesh pops in the prompt bar.
      ctx.fillStyle = active ? "rgba(28, 18, 64, 0.95)" : "rgba(12, 10, 28, 0.95)";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();

      const glow = ctx.createRadialGradient(
        size * 0.5,
        size * 0.45,
        1,
        size * 0.5,
        size * 0.5,
        size * 0.55,
      );
      glow.addColorStop(0, active ? "rgba(168, 130, 255, 0.7)" : "rgba(130, 100, 255, 0.5)");
      glow.addColorStop(0.55, active ? "rgba(56, 189, 160, 0.25)" : "rgba(56, 160, 180, 0.15)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of synapses) {
        const a = projected[s.a];
        const b = projected[s.b];
        if (!a || !b) continue;
        const pulse = 0.75 + 0.25 * Math.sin(time * 2.4 + s.a * 0.08);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `hsla(265, 90%, 82%, ${0.55 * pulse})`;
        ctx.lineWidth = 1.05;
        ctx.stroke();
      }

      for (const pt of projected) {
        const p = pt.particle;
        const twinkle = 0.7 + 0.3 * Math.sin(time * 2.6 + p.phase);
        const r = Math.max(1.1, p.size * 0.42 * twinkle);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 95%, 72%, ${0.28 * twinkle})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 95%, 80%, ${0.95 * twinkle})`;
        ctx.fill();
      }
      ctx.restore();

      if (!reduced) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [particles, synapses, reduced, size, active]);

  return (
    <span
      className={`relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[0_0_12px_rgba(129,140,248,0.35)] ring-1 ring-indigo-300/40 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </span>
  );
}
