import { Link } from "wouter";
import { AlertTriangle, Clock, Hourglass, Sparkles, ArrowRight } from "lucide-react";
import type { DailyBriefing, BriefingItem } from "@/lib/home-briefing";

type Props = {
  briefing: DailyBriefing;
  date: string;
};

function Column({
  icon,
  label,
  accent,
  items,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  items: BriefingItem[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className={accent}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/45">{label}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-white/30">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block truncate text-sm text-zinc-200 no-underline hover:text-white"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DailyBriefingCard({ briefing, date }: Props) {
  return (
    <section className="nebula-glass relative overflow-hidden rounded-3xl p-6 md:p-8">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-violet-500/15 blur-3xl" />

      <div className="relative">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-indigo-300/70">
          <Sparkles className="h-3.5 w-3.5" />
          Daily briefing
          <span className="text-white/25">·</span>
          <span className="normal-case tracking-normal text-white/40">{date}</span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-gradient-nebula md:text-4xl">
          {briefing.greeting}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-300 md:text-lg">
          {briefing.summary}
        </p>

        {(briefing.critical.length > 0 ||
          briefing.waiting.length > 0 ||
          briefing.reminders.length > 0) && (
          <div className="mt-6 grid grid-cols-1 gap-5 border-t border-white/10 pt-6 sm:grid-cols-3">
            <Column
              icon={<AlertTriangle className="h-4 w-4" />}
              accent="text-pink-400"
              label="Critical"
              items={briefing.critical}
              empty="Nothing critical."
            />
            <Column
              icon={<Hourglass className="h-4 w-4" />}
              accent="text-sky-400"
              label="Waiting"
              items={briefing.waiting}
              empty="Not waiting on anyone."
            />
            <Column
              icon={<Clock className="h-4 w-4" />}
              accent="text-amber-400"
              label="Reminders"
              items={briefing.reminders}
              empty="No reminders."
            />
          </div>
        )}

        {briefing.suggestedAction && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
              Suggested next
            </span>
            <Link
              href={briefing.suggestedAction.href}
              className="group inline-flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-sm font-medium text-white no-underline shadow-lg shadow-indigo-500/25 transition-colors hover:bg-indigo-400"
            >
              <span className="max-w-[60vw] truncate sm:max-w-xs">{briefing.suggestedAction.label}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
