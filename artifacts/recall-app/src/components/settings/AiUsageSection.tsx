import React, { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { getAiUsage, type AiUsageSummary } from "@/lib/recall-api";

/** Plain-language names for the internal feature keys. */
const FEATURE_LABELS: Record<string, string> = {
  attachment_ocr: "Reading text from images",
  digest: "Note and capture summaries",
  deadline_extract: "Finding deadlines in email",
  waiting_extract: "Finding follow-ups in email",
  capture_classify: "Sorting new captures",
  intent_route: "Understanding what you typed",
  ask_query: "Ask answers",
  transcribe: "Voice transcription",
  tts: "Spoken answers",
  embedding: "Search indexing",
  other: "Other",
};

function labelFor(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.replace(/_/g, " ");
}

/** Cents matter here, so show enough precision to see sub-cent calls. */
function usd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `<$0.01`;
  return `$${value.toFixed(2)}`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AiUsageSection({ isAdmin = false }: { isAdmin?: boolean }) {
  const [days, setDays] = useState(30);
  const [everyone, setEveryone] = useState(isAdmin);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAiUsage(days, everyone && isAdmin)
      .then((res) => {
        if (!cancelled) setUsage(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load usage");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, everyone, isAdmin]);

  const maxDay = Math.max(...(usage?.daily.map((d) => d.costUsd) ?? [0]), 0.0001);
  const overBudget =
    usage != null && usage.budgetUsd > 0 && usage.todayUsd >= usage.budgetUsd;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DollarSign size={18} className="text-indigo-300" />
          <h2 className="text-lg font-medium text-white">AI usage</h2>
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-black/20 p-0.5 text-xs">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDays(n)}
              className={`rounded-lg px-2.5 py-1 ${
                days === n ? "bg-indigo-500 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-white/45">
        Estimated OpenAI spend, by day and by what asked for it. Your OpenAI invoice is
        still the final word.
      </p>

      {isAdmin && (
        <label className="mt-3 flex items-center gap-2 text-xs text-white/50">
          <input
            type="checkbox"
            checked={everyone}
            onChange={(e) => setEveryone(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-white/20 bg-black/30 accent-indigo-500"
          />
          Show every account, not just mine
        </label>
      )}

      {loading && <p className="mt-5 text-sm text-white/40">Loading usage…</p>}

      {error && (
        <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-200/80">
          {error}
        </p>
      )}

      {usage && !loading && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-xs text-white/40">Today</p>
              <p
                className={`mt-0.5 text-xl font-semibold ${
                  overBudget ? "text-amber-300" : "text-white"
                }`}
              >
                {usd(usage.todayUsd)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-xs text-white/40">Last {days} days</p>
              <p className="mt-0.5 text-xl font-semibold text-white">
                {usd(usage.totalUsd)}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 sm:col-span-1">
              <p className="text-xs text-white/40">Daily cap</p>
              <p className="mt-0.5 text-xl font-semibold text-white">
                {usage.budgetUsd > 0 ? usd(usage.budgetUsd) : "None"}
              </p>
            </div>
          </div>

          {overBudget && (
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
              Today's cap is reached. Background work (image reading, email scanning,
              summaries) is paused until midnight UTC. Ask still works.
            </p>
          )}

          {usage.daily.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wider text-white/35">
                Per day
              </p>
              <ul className="mt-3 space-y-1.5">
                {usage.daily.map((day) => (
                  <li key={day.date} className="flex items-center gap-3 text-xs">
                    <span className="w-14 shrink-0 text-white/45">
                      {dayLabel(day.date)}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-indigo-500/70"
                        style={{
                          width: `${Math.max(2, (day.costUsd / maxDay) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-white/70">
                      {usd(day.costUsd)}
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-white/30">
                      {day.calls} {day.calls === 1 ? "call" : "calls"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {usage.rows.length > 0 ? (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wider text-white/35">
                What spent it
              </p>
              <ul className="mt-3 space-y-1.5">
                {usage.rows.map((row) => (
                  <li
                    key={`${row.feature}:${row.model}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/80">
                        {labelFor(row.feature)}
                      </p>
                      <p className="text-[11px] text-white/35">
                        {row.model} · {row.calls.toLocaleString()}{" "}
                        {row.calls === 1 ? "call" : "calls"} ·{" "}
                        {row.totalTokens.toLocaleString()} tokens
                      </p>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-white/70">
                      {usd(row.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-6 text-sm text-white/40">
              No AI usage recorded in this window.
            </p>
          )}

          <p className="mt-4 text-[11px] text-white/30">
            Tracking started when cost reporting was deployed, so earlier spend won't
            appear here. Only counts and model names are stored — never your content.
          </p>
        </>
      )}
    </section>
  );
}
