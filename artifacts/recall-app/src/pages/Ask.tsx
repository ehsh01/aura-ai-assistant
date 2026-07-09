import React, { useState } from "react";
import { Sparkles, Search, ShieldCheck, ArrowRight } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { queryRecall, type EvidenceRecord } from "@/lib/recall-api";

type Answer = {
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
};

const SUGGESTIONS = [
  "How much did I spend at Publix last month?",
  "What am I waiting on from other people?",
  "Summarize what's most pressing today",
  "What permits or inspections are coming up?",
];

function confidenceLabel(score: number): { label: string; className: string } {
  if (score >= 0.8) return { label: "High confidence", className: "text-emerald-300 bg-emerald-500/10" };
  if (score >= 0.5) return { label: "Needs review", className: "text-amber-300 bg-amber-500/10" };
  return { label: "Low confidence", className: "text-red-300 bg-red-500/10" };
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await queryRecall(trimmed);
      setAnswer(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach Recall AI.");
    } finally {
      setLoading(false);
    }
  };

  const conf = answer ? confidenceLabel(answer.confidence) : null;

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#0a0a0f] p-4 md:p-8 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Ask Recall</p>
          <h1 className="mt-2 text-3xl font-semibold">Ask anything about your world</h1>
          <p className="mt-2 text-white/50">
            Recall answers from your captures, notes, tasks, people, and connected data — and shows
            the evidence behind every answer.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
            className="mt-6 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-indigo-500/50"
          >
            <Search size={18} className="ml-2 text-white/40" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. How much did I spend on groceries this month?"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              <Sparkles size={16} />
              {loading ? "Thinking…" : "Ask"}
            </button>
          </form>

          {!answer && !loading && (
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {answer && (
            <div className="mt-6 space-y-5">
              <section className="rounded-2xl border border-indigo-500/20 bg-white/[0.04] p-5">
                <div className="mb-3 flex items-center gap-2">
                  {conf && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${conf.className}`}>
                      {conf.label} · {Math.round(answer.confidence * 100)}%
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-base leading-relaxed text-white/90">
                  {answer.answer}
                </p>
                {answer.caveats && (
                  <p className="mt-3 border-t border-white/10 pt-3 text-sm text-amber-200/80">
                    ⚠ {answer.caveats}
                  </p>
                )}
                {answer.suggestedNextAction && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-indigo-200">
                    <ArrowRight size={16} />
                    {answer.suggestedNextAction}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  <ShieldCheck size={14} className="text-indigo-300" />
                  Evidence ({answer.evidence.length})
                </div>
                {answer.evidence.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/40">
                    No specific evidence was linked for this answer. Treat it as a best-effort
                    interpretation and verify before acting.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {answer.evidence.map((ev) => (
                      <article
                        key={ev.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <p className="text-xs uppercase tracking-wider text-indigo-300/80">
                          {ev.claimType.replace(/_/g, " ")}
                        </p>
                        {ev.evidenceText && (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-white/75">
                            {ev.evidenceText}
                          </p>
                        )}
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs text-indigo-300 hover:underline"
                          >
                            View source
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {answer.relatedRecords.length > 0 && (
                <section>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                    Related
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {answer.relatedRecords.map((r) => (
                      <span
                        key={`${r.entityType}-${r.entityId}`}
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60"
                      >
                        {r.title}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
