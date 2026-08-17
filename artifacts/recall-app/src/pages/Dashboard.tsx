import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronDown, ChevronRight, History, Search, ShieldCheck, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  createAskThread,
  getAskThread,
  getStoredAskThreadId,
  listAskThreads,
  listPeople,
  planAskInput,
  queryRecallStream,
  sendAskFeedback,
  setStoredAskThreadId,
  type AskMessageRecord,
  type AskEntityLinks,
  type AskProposedAction,
  type AskThreadRecord,
  type EvidenceRecord,
  type PersonRecord,
  type SourceConsulted,
} from "@/lib/recall-api";
import { AskReviewCards } from "@/components/ask/AskReviewCards";
import { useRecallData } from "@/context/RecallDataContext";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { entityPath, readSearchParam } from "@/lib/recall-nav";
import { NeuralBrainBackground } from "@/components/NeuralBrainBackground";
import { NeuralBrainOrb } from "@/components/NeuralBrainOrb";
import { MicButton } from "@/components/MicButton";
import { RecallLogo } from "@/components/RecallLogo";
import { stopSpeaking } from "@/lib/speech-synthesis";
import { AskAnswerImages } from "@/components/AskAnswerImages";
import type { AskAnswerImage } from "@/lib/recall-api";
import { toast } from "@/hooks/use-toast";

function isPureQuestion(text: string): boolean {
  const t = text.trim();
  if (/\b(remind me|add a task|remember that|follow up|put .+ on .+ calendar|snooze)\b/i.test(t)) {
    return false;
  }
  return /^(what|who|when|where|why|how|which|show|list|did|is|are|was|were|do i|am i)\b/i.test(t) || /\?\s*$/.test(t);
}

function imagesFromMetadata(metadata: Record<string, unknown> | undefined): AskAnswerImage[] {
  if (!metadata || !Array.isArray(metadata.images)) return [];
  return metadata.images as AskAnswerImage[];
}

function primaryLinkFromEvidence(evidence: EvidenceRecord[]): {
  url: string;
  label: string;
} | null {
  for (const ev of evidence) {
    const url =
      typeof ev.evidenceMetadata?.sourceUrl === "string"
        ? ev.evidenceMetadata.sourceUrl
        : null;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const explicit =
      typeof ev.evidenceMetadata?.primaryLinkLabel === "string"
        ? ev.evidenceMetadata.primaryLinkLabel
        : null;
    const label =
      explicit ??
      (/mail\.google\.com/i.test(url)
        ? "Open in Gmail"
        : /(drive|docs|sheets|slides)\.google\.com/i.test(url)
          ? "Open in Drive"
          : "Open source");
    return { url, label };
  }
  return null;
}

type AnswerMeta = {
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  relatedRecords: { entityType: string; entityId: string; title: string }[];
  images: AskAnswerImage[];
  suggestedNextAction: string | null;
  sourcesConsulted?: SourceConsulted[];
  presentation?: "full" | "compact";
  privacy?: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

/** Immersive oracle Home — background + ask only. History stays behind a tab. */
export function Dashboard() {
  const { notes, tasks, reloadTasks } = useRecallData();
  const [question, setQuestion] = useState("");
  /** Only the current turn (latest Q + A) — not the full thread. */
  const [liveMessages, setLiveMessages] = useState<AskMessageRecord[]>([]);
  const [answerImages, setAnswerImages] = useState<AskAnswerImage[]>([]);
  const [reviewActions, setReviewActions] = useState<AskProposedAction[]>([]);
  const [reviewCaptureId, setReviewCaptureId] = useState<string | null>(null);
  const [reviewLinks, setReviewLinks] = useState<AskEntityLinks | undefined>(undefined);
  const [answerMeta, setAnswerMeta] = useState<AnswerMeta | null>(null);
  const [assistantMessageId, setAssistantMessageId] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<"up" | "down" | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(getStoredAskThreadId());
  const [askPending, setAskPending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<AskThreadRecord[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyMessages, setHistoryMessages] = useState<AskMessageRecord[]>([]);
  const [historyTitle, setHistoryTitle] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** While the answer panel is open, follow-ups stay on the same thread. */
  const sessionActive = useRef(false);

  useEffect(() => {
    void listCaptureInbox()
      .then((res) => setCaptures(res.items as RecallCaptureItem[]))
      .catch(() => {});
    void listProjects()
      .then((res) => setProjects(res.projects as RecallProject[]))
      .catch(() => {});
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
  }, []);

  // Keep thread id for API continuity, but never restore chat into the home panel.
  useEffect(() => {
    const stored = getStoredAskThreadId();
    if (stored) setThreadId(stored);
  }, []);

  // Deep link: /ask?q=… auto-ask
  useEffect(() => {
    const q = readSearchParam("q")?.trim();
    if (!q) return;
    setQuestion(q);
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (panelOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveMessages, askPending, panelOpen]);

  const refreshThreads = async () => {
    try {
      const res = await listAskThreads();
      setThreads(res.threads);
    } catch {
      // ignore
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryMessages([]);
    setHistoryTitle(null);
    setHistoryQuery("");
    void refreshThreads();
  };

  const openHistoryThread = async (id: string, title: string) => {
    setHistoryLoading(true);
    setHistoryTitle(title);
    try {
      const detail = await getAskThread(id);
      setHistoryMessages(detail.messages);
    } catch {
      setHistoryMessages([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || askPending) return;
    stopSpeaking();
    setQuestion("");
    setAskPending(true);
    setPanelOpen(true);
    setHistoryOpen(false);

    let activeThreadId = threadId;
    // Fresh session when the panel was closed — don't surface old chat.
    if (!sessionActive.current) {
      try {
        const created = await createAskThread();
        activeThreadId = created.thread.id;
        setThreadId(activeThreadId);
        setStoredAskThreadId(activeThreadId);
      } catch {
        // Fall back to existing thread id if create fails.
      }
      sessionActive.current = true;
    }

    const tempId = `local-${Date.now()}`;
    setAnswerImages([]);
    setReviewActions([]);
    setReviewCaptureId(null);
    setReviewLinks(undefined);
    setAnswerMeta(null);
    setAssistantMessageId(null);
    setFeedbackSent(null);
    setSourcesExpanded(false);
    setLiveMessages([
      {
        id: tempId,
        threadId: activeThreadId ?? "pending",
        role: "user",
        content: q,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      if (isPureQuestion(q)) {
        const assistantId = `${tempId}-a`;
        setLiveMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            threadId: activeThreadId ?? "local",
            role: "assistant",
            content: "",
            metadata: {},
            createdAt: new Date().toISOString(),
          },
        ]);
        try {
          const streamed = await queryRecallStream(q, {
            threadId: activeThreadId,
            onToken: (delta) => {
              setLiveMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: `${m.content}${delta}` } : m,
                ),
              );
            },
          });
          const images = streamed.images ?? [];
          setAnswerImages(images);
          setAssistantMessageId(streamed.assistantMessageId ?? null);
          setAnswerMeta({
            confidence: streamed.confidence,
            caveats: streamed.caveats,
            evidence: streamed.evidence,
            relatedRecords: streamed.relatedRecords,
            images,
            suggestedNextAction: streamed.suggestedNextAction,
            privacy: streamed.privacy,
            sourcesConsulted: streamed.sourcesConsulted ?? [],
            presentation: streamed.presentation ?? "compact",
          });
          if (streamed.threadId) {
            setThreadId(streamed.threadId);
            setStoredAskThreadId(streamed.threadId);
          }
          setLiveMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: streamed.answer, metadata: { images } }
                : m,
            ),
          );
          void refreshThreads();
          return;
        } catch {
          // Fall through to the plan path if streaming is unavailable.
        }
      }

      const res = await planAskInput(q, { threadId: activeThreadId });
      const resolvedThreadId = res.answer?.threadId ?? activeThreadId ?? "local";
      if (res.answer?.threadId) {
        setThreadId(res.answer.threadId);
        setStoredAskThreadId(res.answer.threadId);
      }
      const images = res.answer?.images ?? [];
      setAnswerImages(images);
      setReviewActions(res.mode === "review" ? res.actions : []);
      setReviewCaptureId(res.rawCaptureId);
      setReviewLinks(res.links);
      setAssistantMessageId(res.answer?.assistantMessageId ?? null);
      setFeedbackSent(null);
      setAnswerMeta(
        res.answer
          ? {
              confidence: res.answer.confidence,
              caveats: res.answer.caveats,
              evidence: res.answer.evidence,
              relatedRecords: res.answer.relatedRecords,
              images,
              suggestedNextAction: res.answer.suggestedNextAction,
              privacy: res.answer.privacy,
              sourcesConsulted: res.answer.sourcesConsulted ?? [],
              presentation: res.answer.presentation ?? "compact",
            }
          : null,
      );

      // Assistant lead-in: the answer for questions/mixed, otherwise a short
      // capture acknowledgement above the review cards.
      const assistantText =
        res.answer?.answer ??
        (res.actions.length > 0
          ? "Here's what I can save for you — review and confirm:"
          : "Saved to your Inbox for review.");

      setLiveMessages([
        {
          id: tempId,
          threadId: resolvedThreadId,
          role: "user",
          content: q,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: `${tempId}-a`,
          threadId: resolvedThreadId,
          role: "assistant",
          content: assistantText,
          metadata: { images },
          createdAt: new Date().toISOString(),
        },
      ]);
      void refreshThreads();
    } catch (err) {
      const timedOut =
        err instanceof DOMException && err.name === "TimeoutError";
      setAnswerImages([]);
      setReviewActions([]);
      setReviewCaptureId(null);
      setAnswerMeta(null);
      setAssistantMessageId(null);
      setLiveMessages([
        {
          id: tempId,
          threadId: "local",
          role: "user",
          content: q,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: `${tempId}-a`,
          threadId: "local",
          role: "assistant",
          content: timedOut
            ? "That took too long — usually while refreshing finance. Try again in a moment."
            : "Could not reach Recall. Check that you are signed in and try again.",
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setAskPending(false);
    }
  };

  const closePanel = () => {
    stopSpeaking();
    setPanelOpen(false);
    setLiveMessages([]);
    setAnswerImages([]);
    setReviewActions([]);
    setReviewCaptureId(null);
    setAnswerMeta(null);
    setAssistantMessageId(null);
    setFeedbackSent(null);
    setSourcesExpanded(false);
    setQuestion("");
    sessionActive.current = false;
  };

  const primaryLink = answerMeta ? primaryLinkFromEvidence(answerMeta.evidence) : null;

  const brainGraph = useMemo(
    () => ({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        requesterPersonId: t.requesterPersonId,
        projectId: t.projectId,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        primaryPersonId: n.primaryPersonId,
        projectId: n.projectId,
        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
      })),
      people: people.map((p) => ({ id: p.id, displayName: p.displayName })),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      captures: captures.map((c) => ({
        id: c.id,
        cleanedTitle: c.cleanedTitle,
        status: c.status,
      })),
    }),
    [tasks, notes, people, projects, captures],
  );

  const showAnswer = panelOpen && (askPending || liveMessages.length > 0);

  const filteredThreads = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, historyQuery]);

  return (
    <AppLayout immersive>
      <div className="oracle-home relative h-full w-full overflow-hidden text-zinc-100">
        <div
          className={`pointer-events-none absolute inset-0 z-0 overflow-hidden transition-[filter,transform] duration-700 ease-out ${
            showAnswer || historyOpen ? "scale-[1.03] blur-[2px]" : "scale-100 blur-0"
          }`}
        >
          <NeuralBrainBackground
            graph={brainGraph}
            opacity={1}
            fillScreen
            density={0.9}
            speed={0.7}
            intensity={0.8}
          />
          <div className="orb-1 nebula-orb opacity-50" />
          <div className="orb-2 nebula-orb opacity-40" />
          <div className="orb-3 nebula-orb opacity-36" />
          <div className="orb-4 nebula-orb opacity-28" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700"
          style={{
            background:
              showAnswer || historyOpen
                ? "radial-gradient(ellipse 70% 55% at 50% 48%, transparent 0%, rgba(0,0,0,0.55) 100%)"
                : "radial-gradient(ellipse 88% 72% at 50% 45%, transparent 35%, rgba(0,0,0,0.12) 100%)",
          }}
        />

        {showAnswer && (
          <button
            type="button"
            aria-label="Dismiss answer"
            onClick={closePanel}
            className="oracle-answer-scrim absolute inset-0 z-20 cursor-default border-0 bg-black/45 backdrop-blur-md"
          />
        )}

        {historyOpen && (
          <button
            type="button"
            aria-label="Dismiss history"
            onClick={() => setHistoryOpen(false)}
            className="absolute inset-0 z-20 cursor-default border-0 bg-black/45 backdrop-blur-md"
          />
        )}

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
          <div
            className={`flex w-full max-w-2xl flex-col items-center transition-all duration-700 ease-out ${
              showAnswer || historyOpen
                ? "pointer-events-none -translate-y-8 scale-95 opacity-40"
                : "opacity-100"
            }`}
          >
            <div className="oracle-brand mb-8 flex flex-col items-center gap-3">
              <RecallLogo size={56} />
              <h1 className="font-[family-name:var(--font-oracle,inherit)] text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Recall
              </h1>
              <p className="max-w-md rounded-full bg-black/55 px-4 py-1.5 text-center text-sm text-white/70 shadow-[0_0_24px_rgba(0,0,0,0.45)] backdrop-blur-md md:text-base">
                Ask anything about your world.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(question);
              }}
              className="oracle-prompt-shell w-full"
            >
              <div className="oracle-prompt flex items-center gap-3 px-4 py-3 md:px-5 md:py-4">
                <NeuralBrainOrb active={askPending} size={44} />
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What do you need to know?"
                  autoFocus
                  className="min-w-0 flex-1 border-none bg-transparent text-base text-white outline-none placeholder:text-white/35 md:text-lg"
                />
                <MicButton
                  onTranscript={(t) => setQuestion((prev) => (prev ? `${prev} ${t}` : t))}
                  iconSize={20}
                  title="Voice"
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || askPending}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:opacity-40"
                  aria-label="Ask"
                >
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        <button
          type="button"
          onClick={openHistory}
          className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top,0px))] z-40 flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md transition hover:bg-black/70 hover:text-white md:right-6"
          aria-label="Open ask history"
        >
          <History size={14} />
          History
        </button>

        {historyOpen && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[78%] justify-center px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:inset-x-auto md:left-1/2 md:bottom-auto md:top-1/2 md:w-full md:max-w-2xl md:-translate-x-1/2 md:-translate-y-[42%] md:px-4 md:pb-0">
            <article className="oracle-answer-card relative flex max-h-full w-full flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white"
                aria-label="Close history"
              >
                <X size={18} />
              </button>
              <div className="border-b border-white/10 px-5 py-4 md:px-7">
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">History</p>
                <h2 className="mt-1 text-lg font-medium text-white">Past questions</h2>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <Search size={14} className="text-white/35" />
                  <input
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder="Search history…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                  />
                </div>
              </div>
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="w-[42%] overflow-y-auto border-r border-white/10 recall-scrollbar">
                  {filteredThreads.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-white/40">No saved questions yet.</p>
                  ) : (
                    filteredThreads.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => void openHistoryThread(t.id, t.title)}
                        className={`block w-full truncate border-b border-white/5 px-4 py-3 text-left text-xs transition hover:bg-white/5 ${
                          historyTitle === t.title ? "bg-white/10 text-white" : "text-white/60"
                        }`}
                        title={t.title}
                      >
                        {t.title}
                      </button>
                    ))
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 recall-scrollbar">
                  {historyLoading && (
                    <p className="text-sm text-white/40">Loading…</p>
                  )}
                  {!historyLoading && historyMessages.length === 0 && (
                    <p className="text-sm text-white/40">
                      {historyTitle ? "No messages in this chat." : "Select a chat to read it."}
                    </p>
                  )}
                  {!historyLoading &&
                    historyMessages.map((m) => {
                      const imgs = imagesFromMetadata(m.metadata);
                      return (
                        <div key={m.id} className="mb-3 space-y-2">
                          <div
                            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <p
                              className={`max-w-[95%] whitespace-pre-wrap text-sm leading-relaxed ${
                                m.role === "user"
                                  ? "rounded-2xl bg-indigo-500/25 px-3 py-2 text-indigo-50"
                                  : "text-white/90"
                              }`}
                            >
                              {m.content}
                            </p>
                          </div>
                          {m.role === "assistant" && imgs.length > 0 && (
                            <AskAnswerImages images={imgs} />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </article>
          </div>
        )}

        {showAnswer && (
          <div className="oracle-answer-panel absolute inset-x-0 bottom-0 z-30 flex max-h-[78%] justify-center px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:inset-x-auto md:left-1/2 md:bottom-auto md:top-1/2 md:w-full md:max-w-2xl md:-translate-x-1/2 md:-translate-y-[42%] md:px-4 md:pb-0">
            <article className="oracle-answer-card relative flex max-h-full w-full flex-col overflow-hidden">
              <button
                type="button"
                onClick={closePanel}
                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-8 recall-scrollbar md:px-7 md:py-10">
                {liveMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-center"}`}
                  >
                    <p
                      className={`max-w-[95%] whitespace-pre-wrap text-base leading-relaxed md:text-lg ${
                        m.role === "user"
                          ? "rounded-2xl bg-indigo-500/25 px-4 py-2 text-left text-indigo-50"
                          : "w-full max-w-lg text-left text-white/95"
                      }`}
                    >
                      {m.content}
                    </p>
                  </div>
                ))}
                {!askPending && answerImages.length > 0 && (
                  <div className="mx-auto w-full max-w-lg">
                    <AskAnswerImages images={answerImages} />
                  </div>
                )}
                {!askPending && reviewActions.length > 0 && (
                  <AskReviewCards
                    actions={reviewActions}
                    rawCaptureId={reviewCaptureId}
                    threadId={threadId}
                    links={reviewLinks}
                    onConfirmed={() => {
                      void reloadTasks().catch(() => {});
                      void listCaptureInbox()
                        .then((res) => setCaptures(res.items as RecallCaptureItem[]))
                        .catch(() => {});
                    }}
                  />
                )}
                {!askPending && answerMeta && (
                  <div className="mx-auto w-full max-w-lg space-y-4 pt-2 text-left">
                    {primaryLink && (
                      <a
                        href={primaryLink.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-3 py-2 text-sm font-medium text-indigo-100 no-underline hover:bg-indigo-500/25"
                      >
                        {primaryLink.label}
                        <ArrowRight size={14} />
                      </a>
                    )}
                    {assistantMessageId && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
                        <span>Was this helpful?</span>
                        <button
                          type="button"
                          disabled={feedbackSent != null}
                          className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
                          onClick={() =>
                            void sendAskFeedback(assistantMessageId, "up").then(() => {
                              setFeedbackSent("up");
                              toast({ title: "Thanks for the feedback" });
                            })
                          }
                        >
                          {feedbackSent === "up" ? "Thanks" : "👍"}
                        </button>
                        <button
                          type="button"
                          disabled={feedbackSent != null}
                          className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
                          onClick={() => {
                            const note = window.prompt(
                              "What was wrong? (optional — helps improve future answers)",
                            );
                            void sendAskFeedback(assistantMessageId, "down", note).then(() => {
                              setFeedbackSent("down");
                              toast({ title: "Feedback saved" });
                            });
                          }}
                        >
                          {feedbackSent === "down" ? "Noted" : "👎"}
                        </button>
                      </div>
                    )}
                    {answerMeta.caveats && (
                      <p className="text-sm text-amber-200/80">⚠ {answerMeta.caveats}</p>
                    )}
                    {answerMeta.suggestedNextAction && (
                      <div className="flex items-center gap-2 text-sm text-indigo-200">
                        <ArrowRight size={16} />
                        {answerMeta.suggestedNextAction}
                      </div>
                    )}
                    <section>
                      <button
                        type="button"
                        onClick={() => setSourcesExpanded((v) => !v)}
                        className="mb-2 flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-white/45 hover:text-white/70"
                      >
                        {sourcesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <ShieldCheck size={14} className="text-indigo-300" />
                        Sources
                        {answerMeta.evidence.length > 0
                          ? ` (${answerMeta.evidence.length})`
                          : ""}
                      </button>
                      {sourcesExpanded &&
                        (answerMeta.evidence.length === 0 ? (
                          <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/40">
                            No specific sources were linked for this answer.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {answerMeta.evidence.map((ev) => {
                              const relatedType =
                                typeof ev.evidenceMetadata?.relatedEntityType === "string"
                                  ? ev.evidenceMetadata.relatedEntityType
                                  : ev.entityType;
                              const relatedId =
                                typeof ev.evidenceMetadata?.relatedEntityId === "string"
                                  ? ev.evidenceMetadata.relatedEntityId
                                  : ev.entityId;
                              const href = entityPath(relatedType, relatedId);
                              const sourceUrl =
                                typeof ev.evidenceMetadata?.sourceUrl === "string"
                                  ? ev.evidenceMetadata.sourceUrl
                                  : null;
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
                                  {sourceUrl ? (
                                    <a
                                      href={sourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-2 inline-block text-xs text-indigo-300 no-underline hover:underline"
                                    >
                                      Open link
                                    </a>
                                  ) : href ? (
                                    <Link
                                      href={href}
                                      className="mt-2 inline-block text-xs text-indigo-300 no-underline hover:underline"
                                    >
                                      Open {relatedType}
                                    </Link>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        ))}
                    </section>
                  </div>
                )}
                {askPending && (
                  <p className="text-center text-lg text-white/50">
                    Checking your connected sources…
                  </p>
                )}
                <div ref={bottomRef} />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(question);
                }}
                className="border-t border-white/10 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a follow-up…"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
                  />
                  <button
                    type="submit"
                    disabled={!question.trim() || askPending}
                    className="rounded-xl bg-indigo-500 px-3 py-2 text-sm text-white disabled:opacity-40"
                  >
                    Ask
                  </button>
                </div>
              </form>
            </article>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
