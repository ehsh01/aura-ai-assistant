import { Link } from "wouter";
import { Activity, ArrowRight, User } from "lucide-react";
import type { ActivityRecord } from "@/lib/recall-api";
import { peoplePath } from "@/lib/recall-nav";

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

function personFrom(item: ActivityRecord): { id: string | null; name: string | null } {
  const m = item.metadata;
  return {
    id: typeof m.personId === "string" ? m.personId : null,
    name:
      typeof m.personName === "string"
        ? m.personName
        : typeof m.person === "string"
          ? m.person
          : null,
  };
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
          const person = personFrom(item);
          return (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.03]"
            >
              <div className="min-w-0 flex-1">
                {item.href ? (
                  <Link href={item.href} className="block no-underline">
                    <p className="text-sm text-white/80">{item.label}</p>
                    {line && <p className="mt-0.5 truncate text-xs text-white/40">{line}</p>}
                  </Link>
                ) : (
                  <>
                    <p className="text-sm text-white/80">{item.label}</p>
                    {line && <p className="mt-0.5 truncate text-xs text-white/40">{line}</p>}
                  </>
                )}
                {person.name && (
                  <div className="mt-1">
                    {person.id ? (
                      <Link
                        href={peoplePath({ personId: person.id })}
                        className="inline-flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-200 no-underline hover:bg-sky-500/20"
                      >
                        <User size={10} />
                        {person.name}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-sky-200/70">
                        <User size={10} />
                        {person.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="flex-shrink-0 text-[11px] text-white/30">{formatWhen(item.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
