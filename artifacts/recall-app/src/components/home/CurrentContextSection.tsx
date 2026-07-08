import { Link } from "wouter";
import { Layers } from "lucide-react";
import type { ContextArea } from "@/lib/home-briefing";

type Props = {
  areas: ContextArea[];
};

const ACCENT: Record<string, { dot: string; glow: string }> = {
  indigo: { dot: "bg-indigo-400", glow: "group-hover:border-indigo-400/40" },
  violet: { dot: "bg-violet-400", glow: "group-hover:border-violet-400/40" },
  emerald: { dot: "bg-emerald-400", glow: "group-hover:border-emerald-400/40" },
  amber: { dot: "bg-amber-400", glow: "group-hover:border-amber-400/40" },
  rose: { dot: "bg-rose-400", glow: "group-hover:border-rose-400/40" },
  sky: { dot: "bg-sky-400", glow: "group-hover:border-sky-400/40" },
  pink: { dot: "bg-pink-400", glow: "group-hover:border-pink-400/40" },
};

export function CurrentContextSection({ areas }: Props) {
  if (areas.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <Layers className="h-4 w-4 text-indigo-400" /> Current mental context
      </h2>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {areas.map((area) => {
          const accent = ACCENT[area.accent] ?? ACCENT.indigo!;
          return (
            <Link
              key={area.id}
              href={area.href}
              className={`nebula-glass group flex items-center gap-3 rounded-2xl p-4 no-underline transition-transform hover:-translate-y-0.5 ${accent.glow}`}
            >
              <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${accent.dot}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{area.name}</p>
                <p className="text-xs text-white/35">
                  {area.count > 0 ? `${area.count} item${area.count === 1 ? "" : "s"}` : "Open"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
