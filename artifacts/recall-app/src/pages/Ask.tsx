import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Sparkles, Search, ShieldCheck, ArrowRight, Volume2, VolumeX, Plus } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  createAskThread,
  fetchHome,
  getAskThread,
  getStoredAskThreadId,
  listAskThreads,
  listPeople,
  listWaitingOn,
  queryRecall,
  setStoredAskThreadId,
  type AskMessageRecord,
  type AskThreadRecord,
  type EvidenceRecord,
} from "@/lib/recall-api";
import { entityPath, readSearchParam } from "@/lib/recall-nav";
import { useSpeakAnswer } from "@/hooks/use-speak-answer";
import { stopSpeaking } from "@/lib/speech-synthesis";

type AnswerMeta = {
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  suggestedNextAction: string | null;
  privacy?: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

function privacyChipLabel(privacy: NonNullable<AnswerMeta["privacy"]>): string {
  const cats = privacy.categoriesSent
    .map((c) => {
      if (c === "memory") return "Memory";
      if (c === "note") return "Notes";
      if (c === "task") return "Tasks";
      if (c === "knowledge") return "Knowledge";
      if (c === "person") return "People";
      return c;
    })
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4);
  const used = cats.length > 0 ? cats.join(" + ") : "your data";
  if (!privacy.dataLeftDevice) {
    return `Answer used ${used} · stayed on device`;
  }
  const model = privacy.model ? ` · sent to ${privacy.model}` : " · sent to AI";
  return `Answer used ${used}${model}`;
}

const FALLBACK_SUGGESTIONS = [
  "What am I waiting on from other people?",
  "Summarize what's most pressing today",
  "How much did I spend this month?",
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
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS);
  const [threadId, setThreadId] = useState<string | null>(getStoredAskThreadId());
  const [threads, setThreads] = useState<AskThreadRecord[]>([]);
  const [messages, setMessages] = useState<AskMessageRecord[]>([]);
  const [latestMeta, setLatestMeta] = useState<AnswerMeta | null>(null);
  const autoAsked = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? null;
  const voice = useSpeakAnswer(latestAssistant, Boolean(latestAssistant && !loading));

  const refreshThreads = async () => {
    try {
      const res = await listAskThreads();
      setThreads(res.threads);
    } catch {
      // ignore
    }
  };

  const loadThread = async (id: string) => {
    const detail = await getAskThread(id);
    setThreadId(detail.thread.id);
    setStoredAskThreadId(detail.thread.id);
    setMessages(detail.messages);
    setLatestMeta(null);
  };

  useEffect(() => {
    void (async () => {
      await refreshThreads();
      // Keep thread id for API continuity, but don't paint history until the user opens it.
      const stored = getStoredAskThreadId();
      if (stored) setThreadId(stored);
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startNewChat = async () => {
    stopSpeaking();
    setLoading(true);
    setError(null);
    setLatestMeta(null);
    try {
      const res = await createAskThread();
      setThreadId(res.thread.id);
      setStoredAskThreadId(res.thread.id);
      setMessages([]);
      await refreshThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new chat.");
    } finally {
      setLoading(false);
    }
  };

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    stopSpeaking();
    setQuestion("");
    setLoading(true);
    setError(null);
    // Show only this turn in the main pane (history stays in the sidebar).
    const tempId = `local-${Date.now()}`;
    setMessages([
      {
        id: tempId,
        threadId: threadId ?? "pending",
        role: "user",
        content: trimmed,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await queryRecall(trimmed, { threadId });
      if (res.threadId) {
        setThreadId(res.threadId);
        setStoredAskThreadId(res.threadId);
        await refreshThreads();
      }
      setMessages([
        {
          id: tempId,
          threadId: res.threadId ?? threadId ?? "local",
          role: "user",
          content: trimmed,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: `${tempId}-a`,
          threadId: res.threadId ?? threadId ?? "local",
          role: "assistant",
          content: res.answer,
          metadata: {
            confidence: res.confidence,
            caveats: res.caveats,
          },
          createdAt: new Date().toISOString(),
        },
      ]);
      setLatestMeta({
        confidence: res.confidence,
        caveats: res.caveats,
        evidence: res.evidence,
        relatedRecords: res.relatedRecords,
        suggestedNextAction: res.suggestedNextAction,
        privacy: res.privacy,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach Recall AI.");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([
      listWaitingOn().catch(() => ({ items: [] })),
      fetchHome().catch(() => null),
      listPeople().catch(() => ({ people: [] })),
    ]).then(([waiting, home, peopleRes]) => {
      const next: string[] = [];
      const topWait = waiting.items[0];
      if (topWait) {
        next.push(`What am I waiting on from ${topWait.person}?`);
      } else {
        next.push("What am I waiting on from other people?");
      }
      const topPerson =
        peopleRes.people.find((p) => p.displayName !== topWait?.person) ??
        peopleRes.people[0];
      if (topPerson) {
        next.push(`What do I know about ${topPerson.displayName}?`);
      }
      next.push("Summarize what's most pressing today");
      if (home?.finance && !home.finance.needsSync) {
        const payee = home.finance.topPayee?.payee;
        next.push(
          payee
            ? `How much did I spend at ${payee} this month?`
            : "How much did I spend this month?",
        );
      } else {
        next.push("How much did I spend this month?");
      }
      if (next.length < 4) {
        next.push("What permits or inspections are coming up?");
      }
      setSuggestions(next.slice(0, 4));
    });
  }, []);

  useEffect(() => {
    const q = readSearchParam("q")?.trim();
    if (!q || autoAsked.current === q) return;
    autoAsked.current = q;
    void ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conf = latestMeta ? confidenceLabel(latestMeta.confidence) : null;

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden bg-[#0a0a0f] text-white">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/10 bg-black/20 p-3 md:flex">
          <button
            type="button"
            onClick={() => void startNewChat()}
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-500/20 px-3 py-2 text-sm text-indigo-100 hover:bg-indigo-500/30"
          >
            <Plus size={16} />
            New chat
          </button>
          <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-white/35">Recent</p>
          <div className="flex-1 space-y-1 overflow-y-auto recall-scrollbar">
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void loadThread(t.id).catch(() => setError("Could not open chat"))}
                className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-xs ${
                  t.id === threadId
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white/80"
                }`}
                title={t.title}
              >
                {t.title}
              </button>
            ))}
            {threads.length === 0 && (
              <p className="px-2 text-xs text-white/35">No saved chats yet.</p>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-white/10 px-4 py-4 md:px-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Ask Recall</p>
                <h1 className="mt-1 text-2xl font-semibold md:text-3xl">Ask anything about your world</h1>
                <p className="mt-1 text-sm text-white/45">
                  Each ask shows only the current answer. Open a chat in Recent to browse history.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void startNewChat()}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5 md:hidden"
              >
                New chat
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8 recall-scrollbar">
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.length === 0 && !loading && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
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

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-indigo-500/25 text-indigo-50"
                        : "border border-white/10 bg-white/[0.04] text-white/90"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/45">
                    Thinking…
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                  {error}
                </div>
              )}

              {latestMeta && !loading && (
                <div className="space-y-4 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {conf && (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${conf.className}`}>
                        {conf.label} · {Math.round(latestMeta.confidence * 100)}%
                      </span>
                    )}
                    {latestMeta.privacy && (
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-white/55">
                        {privacyChipLabel(latestMeta.privacy)}
                      </span>
                    )}
                    {voice.supported && (
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (voice.speaking) voice.stop();
                            else voice.replay();
                          }}
                          className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                          aria-label={voice.speaking ? "Stop speaking" : "Read answer aloud"}
                        >
                          <Volume2 size={16} className={voice.speaking ? "text-indigo-300" : undefined} />
                        </button>
                        <button
                          type="button"
                          onClick={() => voice.setVoiceEnabled(!voice.enabled)}
                          className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                          aria-label={voice.enabled ? "Mute voice answers" : "Enable voice answers"}
                        >
                          {voice.enabled ? (
                            <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                              Voice
                            </span>
                          ) : (
                            <VolumeX size={16} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {latestMeta.caveats && (
                    <p className="text-sm text-amber-200/80">⚠ {latestMeta.caveats}</p>
                  )}
                  {latestMeta.suggestedNextAction && (
                    <div className="flex items-center gap-2 text-sm text-indigo-200">
                      <ArrowRight size={16} />
                      {latestMeta.suggestedNextAction}
                    </div>
                  )}
                  <section>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                      <ShieldCheck size={14} className="text-indigo-300" />
                      Evidence ({latestMeta.evidence.length})
                    </div>
                    {latestMeta.evidence.length === 0 ? (
                      <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/40">
                        No specific evidence was linked for this answer.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {latestMeta.evidence.map((ev) => {
                          const relatedType =
                            typeof ev.evidenceMetadata?.relatedEntityType === "string"
                              ? ev.evidenceMetadata.relatedEntityType
                              : ev.entityType;
                          const relatedId =
                            typeof ev.evidenceMetadata?.relatedEntityId === "string"
                              ? ev.evidenceMetadata.relatedEntityId
                              : ev.entityId;
                          const href = entityPath(relatedType, relatedId);
                          return (
                            <article
                              key={ev.id}
                              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                            >
                              <p className="text-xs uppercase tracking-wider text-indigo-300/80">
                                {ev.claimType.replace(/_/g, " ")} · {relatedType}
                              </p>
                              {ev.evidenceText && (
                                <p className="mt-2 whitespace-pre-wrap text-sm text-white/75">
                                  {ev.evidenceText}
                                </p>
                              )}
                              {href && (
                                <Link
                                  href={href}
                                  className="mt-2 inline-block text-xs text-indigo-300 no-underline hover:underline"
                                >
                                  Open {relatedType}
                                </Link>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
            className="border-t border-white/10 px-4 py-3 md:px-8"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-indigo-500/50">
              <Search size={18} className="ml-2 text-white/40" />
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  messages.length > 0
                    ? "Ask a follow-up…"
                    : "e.g. How much did I spend on groceries this month?"
                }
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
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
