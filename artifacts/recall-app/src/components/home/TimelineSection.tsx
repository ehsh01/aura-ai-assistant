import { Link } from "wouter";
import { CheckCircle2, Bell, FileText } from "lucide-react";
import type { TimelineBucket, TimelineEntry } from "@/lib/home-briefing";

type Props = {
  entries: TimelineEntry[];
};

const BUCKET_ORDER: TimelineBucket[] = ["Now", "Next", "Today", "This Week"];

const BUCKET_ACCENT: Record<TimelineBucket, string> = {
  Now: "bg-pink-400",
  Next: "bg-indigo-400",
  Today: "bg-amber-400",
  "This Week": "bg-white/30",
};

function kindIcon(kind: TimelineEntry["kind"]) {
  if (kind === "reminder") return <Bell className="h-3.5 w-3.5 text-amber-300/80" />;
  if (kind === "note") return <FileText className="h-3.5 w-3.5 text-indigo-300/80" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/80" />;
}

export function TimelineSection({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        Timeline
      </h2>
      <div className="relative space-y-6 border-l border-white/10 pl-5">
        {BUCKET_ORDER.map((bucket) => {
          const items = entries.filter((e) => e.bucket === bucket);
          if (items.length === 0) return null;
          return (
            <div key={bucket} className="relative">
              <span
                className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-[#060610] ${BUCKET_ACCENT[bucket]}`}
              />
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
                {bucket}
              </p>
              <div className="space-y-2">
                {items.map((entry) => (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    className="nebula-glass flex items-center gap-3 rounded-2xl px-4 py-3 no-underline transition-transform hover:translate-x-0.5"
                  >
                    {kindIcon(entry.kind)}
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{entry.title}</span>
                    {entry.meta && (
                      <span className="flex-shrink-0 text-xs text-white/35">{entry.meta}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
