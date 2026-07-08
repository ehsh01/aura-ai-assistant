import { Link } from "wouter";
import { Sparkles, ListPlus, Timer, CornerUpRight, GitBranch } from "lucide-react";
import type { InsightItem, InsightKind } from "@/lib/home-briefing";

type Props = {
  insights: InsightItem[];
};

function insightIcon(kind: InsightKind) {
  switch (kind) {
    case "no-task":
      return <ListPlus className="h-4 w-4 text-emerald-300" />;
    case "stale":
      return <Timer className="h-4 w-4 text-amber-300" />;
    case "follow-up":
      return <CornerUpRight className="h-4 w-4 text-sky-300" />;
    case "related":
      return <GitBranch className="h-4 w-4 text-violet-300" />;
  }
}

export function RecallInsightsSection({ insights }: Props) {
  if (insights.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-white/50">
        <Sparkles className="h-4 w-4 text-indigo-400" /> Things Recall noticed
      </h2>

      <div className="space-y-2">
        {insights.map((insight) => {
          const body = (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0">{insightIcon(insight.kind)}</span>
              <p className="text-sm leading-relaxed text-zinc-300">{insight.text}</p>
            </div>
          );
          return insight.href ? (
            <Link
              key={insight.id}
              href={insight.href}
              className="nebula-glass block rounded-2xl border border-indigo-500/10 p-4 no-underline transition-transform hover:translate-x-0.5"
            >
              {body}
            </Link>
          ) : (
            <div key={insight.id} className="nebula-glass rounded-2xl border border-indigo-500/10 p-4">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
