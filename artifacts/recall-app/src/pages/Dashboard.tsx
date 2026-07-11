import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  getAskThread,
  getStoredAskThreadId,
  listPeople,
  queryRecall,
  setStoredAskThreadId,
  type AskMessageRecord,
  type PersonRecord,
} from "@/lib/recall-api";
import { useRecallData } from "@/context/RecallDataContext";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { readSearchParam } from "@/lib/recall-nav";
import { NeuralBrainBackground } from "@/components/NeuralBrainBackground";
import { NeuralBrainOrb } from "@/components/NeuralBrainOrb";
import { MicButton } from "@/components/MicButton";
import { RecallLogo } from "@/components/RecallLogo";
import { useSpeakAnswer } from "@/hooks/use-speak-answer";
import { stopSpeaking } from "@/lib/speech-synthesis";

/** Immersive oracle Home — background + ask only. */
export function Dashboard() {
  const { notes, tasks } = useRecallData();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AskMessageRecord[]>([]);
  const [threadId, setThreadId] = useState<string | null>(getStoredAskThreadId());
  const [askPending, setAskPending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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

  // Restore saved thread so follow-ups continue across reloads.
  useEffect(() => {
    const stored = getStoredAskThreadId();
    if (!stored) return;
    void getAskThread(stored)
      .then((detail) => {
        setThreadId(detail.thread.id);
        setMessages(detail.messages);
      })
      .catch(() => {
        setStoredAskThreadId(null);
        setThreadId(null);
      });
  }, []);

  // Deep link: /?q=… auto-ask
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
  }, [messages, askPending, panelOpen]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || askPending) return;
    stopSpeaking();
    setQuestion("");
    setAskPending(true);
    setPanelOpen(true);
    const tempId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        threadId: threadId ?? "pending",
        role: "user",
        content: q,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await queryRecall(q, { threadId });
      if (res.threadId) {
        setThreadId(res.threadId);
        setStoredAskThreadId(res.threadId);
        const detail = await getAskThread(res.threadId);
        setMessages(detail.messages);
      } else {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempId),
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
            content: res.answer,
            metadata: {},
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
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
          content: "Could not reach Recall. Check that you are signed in and try again.",
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
  };

  const latestAssistant =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? null;
  useSpeakAnswer(latestAssistant, Boolean(latestAssistant && !askPending && panelOpen));

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

  const showAnswer = panelOpen && (askPending || messages.length > 0);

  return (
    <AppLayout immersive>
      <div className="oracle-home relative h-full w-full overflow-hidden text-zinc-100">
        <div
          className={`pointer-events-none absolute inset-0 z-0 overflow-hidden transition-[filter,transform] duration-700 ease-out ${
            showAnswer ? "scale-[1.03] blur-[2px]" : "scale-100 blur-0"
          }`}
        >
          <NeuralBrainBackground graph={brainGraph} opacity={1} fillScreen />
          <div className="orb-1 nebula-orb opacity-50" />
          <div className="orb-2 nebula-orb opacity-40" />
          <div className="orb-3 nebula-orb opacity-36" />
          <div className="orb-4 nebula-orb opacity-28" />
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700"
          style={{
            background: showAnswer
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

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
          <div
            className={`flex w-full max-w-2xl flex-col items-center transition-all duration-700 ease-out ${
              showAnswer ? "pointer-events-none -translate-y-8 scale-95 opacity-40" : "opacity-100"
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
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-center"}`}
                  >
                    <p
                      className={`max-w-[95%] whitespace-pre-wrap text-base leading-relaxed md:text-lg ${
                        m.role === "user"
                          ? "rounded-2xl bg-indigo-500/25 px-4 py-2 text-left text-indigo-50"
                          : "text-center text-white/95"
                      }`}
                    >
                      {m.content}
                    </p>
                  </div>
                ))}
                {askPending && (
                  <p className="text-center text-lg text-white/50">Listening to your world…</p>
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
