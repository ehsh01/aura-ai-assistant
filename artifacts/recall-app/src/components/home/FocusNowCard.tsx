import { Link } from "wouter";
import { Target, Clock3, Play } from "lucide-react";
import type { FocusNow } from "@/lib/home-briefing";

type Props = {
  focus: FocusNow | null;
};

export function FocusNowCard({ focus }: Props) {
  if (!focus) {
    return (
      <section className="nebula-glass rounded-3xl p-6">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300/70">
          <Target className="h-4 w-4" /> Focus right now
        </div>
        <p className="text-sm text-white/40">
          Nothing queued up. Capture something below or add a task to get a focus suggestion.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-600/20 via-[#0e0e18] to-[#0e0e18] p-6 md:p-7">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
          <Target className="h-4 w-4" /> Focus right now
        </div>

        <h2 className="text-2xl font-semibold tracking-tight text-white">{focus.title}</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-300">{focus.reason}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href={focus.href}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0e0e18] no-underline transition-transform hover:scale-[1.02]"
          >
            <Play className="h-4 w-4 fill-current" />
            {focus.actionLabel}
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60">
            <Clock3 className="h-3.5 w-3.5" />
            {focus.estimatedTime}
          </span>
        </div>
      </div>
    </section>
  );
}
