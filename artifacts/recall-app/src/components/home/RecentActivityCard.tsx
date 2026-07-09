import { Link } from "wouter";
import { Activity, ArrowRight } from "lucide-react";
import type { ActivityRecord } from "@/lib/recall-api";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function detail(item: ActivityRecord): string | null {
  const m = item.metadata;
  if (typeof m.title === "string" && m.title.trim()) return m.title;
  if (typeof m.question === "string" && m.question.trim()) return `“${m.question}”`;
  if (typeof m.fileName === "string") return m.fileName;
  if (typeof m.displayName === "string") return m.displayName;
  return null;
}

export function RecentActivityCard({ items }: { items: ActivityRecord[] }) {
  if (items.length === 0) return null;

  return (
    <section className="nebula-glass rounded-2xl border border-white/10 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-indigo-300" />
          <h2 className="text-sm font-semibold text-white/80">Recent activity</h2>
        </div>
        <Link
          href="/activity"
          className="inline-flex items-center gap-1 text-xs text-indigo-300 no-underline hover:underline"
        >
          All activity
          <ArrowRight size={12} />
        </Link>
      </div>
      <div className="space-y-2">
        {items.slice(0, 4).map((item) => {
          const line = detail(item);
          const body = (
            <div className="flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.03]">
              <div className="min-w-0">
                <p className="text-sm text-white/80">{item.label}</p>
                {line && <p className="mt-0.5 truncate text-xs text-white/40">{line}</p>}
              </div>
              <span className="flex-shrink-0 text-[11px] text-white/30">{formatWhen(item.createdAt)}</span>
            </div>
          );
          return item.href ? (
            <Link key={item.id} href={item.href} className="block no-underline">
              {body}
            </Link>
          ) : (
            <div key={item.id}>{body}</div>
          );
        })}
      </div>
    </section>
  );
}
