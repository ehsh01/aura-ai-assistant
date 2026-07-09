import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Activity as ActivityIcon, ArrowRight, Filter } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { listActivity, type ActivityRecord } from "@/lib/recall-api";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "capture_extracted", label: "AI extraction" },
  { id: "capture_accepted", label: "Accepted" },
  { id: "task_created", label: "Tasks" },
  { id: "task_completed", label: "Completed" },
  { id: "connector_sync", label: "Syncs" },
  { id: "query_answered", label: "Ask" },
] as const;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function detailLine(item: ActivityRecord): string | null {
  const m = item.metadata;
  if (typeof m.title === "string" && m.title.trim()) return m.title;
  if (typeof m.question === "string" && m.question.trim()) return `“${m.question}”`;
  if (typeof m.fileName === "string") return m.fileName;
  if (typeof m.displayName === "string") return m.displayName;
  if (typeof m.recordsFetched === "number") {
    return `${m.recordsFetched} records fetched${
      typeof m.recordsCreated === "number" ? `, ${m.recordsCreated} new` : ""
    }`;
  }
  if (typeof m.confidence === "number") {
    return `Confidence ${Math.round(m.confidence * 100)}%`;
  }
  return null;
}

export function Activity() {
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    void listActivity({
      limit: 100,
      action: filter === "all" ? undefined : filter,
    })
      .then((res) => setItems(res.items))
      .finally(() => setLoading(false));
  }, [filter]);

  const emptyCopy = useMemo(
    () =>
      filter === "all"
        ? "No activity yet. Capture something, accept an inbox item, or ask Recall — it will show up here."
        : "No events for this filter yet.",
    [filter],
  );

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Audit</p>
          <h1 className="mt-2 text-3xl font-semibold">Activity</h1>
          <p className="mt-2 text-white/50">
            What Recall created, changed, or answered — so you can verify every AI action.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Filter size={14} className="text-white/35" />
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  filter === f.id
                    ? "bg-indigo-500 text-white"
                    : "border border-white/10 text-white/55 hover:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading && <p className="mt-8 text-white/40">Loading activity…</p>}
          {!loading && items.length === 0 && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/45">
              {emptyCopy}
            </div>
          )}

          <div className="mt-6 space-y-2">
            {items.map((item) => {
              const detail = detailLine(item);
              const body = (
                <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-white/20">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                      <ActivityIcon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{item.label}</h2>
                        <span className="text-xs text-white/35">{formatWhen(item.createdAt)}</span>
                      </div>
                      {detail && <p className="mt-1 text-sm text-white/60">{detail}</p>}
                      <p className="mt-1 text-[11px] uppercase tracking-wider text-white/30">
                        {item.action}
                        {item.entityType ? ` · ${item.entityType}` : ""}
                      </p>
                    </div>
                    {item.href && (
                      <ArrowRight size={16} className="mt-1 flex-shrink-0 text-white/30" />
                    )}
                  </div>
                </article>
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
        </div>
      </div>
    </AppLayout>
  );
}
