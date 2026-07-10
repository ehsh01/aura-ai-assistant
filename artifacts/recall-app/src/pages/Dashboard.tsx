import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Loader2,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  listPeople,
  queryRecall,
  type EvidenceRecord,
  type PersonRecord,
} from "@/lib/recall-api";
import { useRecallData } from "@/context/RecallDataContext";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { entityPath, readSearchParam } from "@/lib/recall-nav";
import { NeuralBrainBackground } from "@/components/NeuralBrainBackground";
import { MicButton } from "@/components/MicButton";
import { RecallLogo } from "@/components/RecallLogo";
import { useSpeakAnswer } from "@/hooks/use-speak-answer";
import { stopSpeaking } from "@/lib/speech-synthesis";

type AskResult = {
  question: string;
  answer: string;
  confidence: number;
  caveats: string | null;
  evidence: EvidenceRecord[];
  suggestedNextAction: string | null;
  privacy?: {
    model: string | null;
    dataLeftDevice: boolean;
    categoriesSent: string[];
  };
};

function privacyChipLabel(privacy: NonNullable<AskResult["privacy"]>): string {
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
  if (!privacy.dataLeftDevice) return `Answer used ${used} · stayed on device`;
  const model = privacy.model ? ` · sent to ${privacy.model}` : " · sent to AI";
  return `Answer used ${used}${model}`;
}

function confidenceLabel(score: number): { label: string; className: string } {
  if (score >= 0.8) return { label: "High confidence", className: "text-emerald-300 bg-emerald-500/10" };
  if (score >= 0.5) return { label: "Needs review", className: "text-amber-300 bg-amber-500/10" };
  return { label: "Low confidence", className: "text-red-300 bg-red-500/10" };
}

/** Immersive oracle Home — background + ask only. */
export function Dashboard() {
  const { notes, tasks } = useRecallData();
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askPending, setAskPending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);

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

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || askPending) return;
    stopSpeaking();
    setQuestion(q);
    setAskPending(true);
    setAskResult(null);
    setPanelOpen(true);
    try {
      const res = await queryRecall(q);
      setAskResult({
        question: q,
        answer: res.answer,
        confidence: res.confidence,
        caveats: res.caveats,
        evidence: res.evidence,
        suggestedNextAction: res.suggestedNextAction,
        privacy: res.privacy,
      });
    } catch {
      setAskResult({
        question: q,
        answer: "Could not reach Recall. Check that you are signed in and try again.",
        confidence: 0,
        caveats: null,
        evidence: [],
        suggestedNextAction: null,
      });
    } finally {
      setAskPending(false);
    }
  };

  const closePanel = () => {
    stopSpeaking();
    setPanelOpen(false);
  };

  const voice = useSpeakAnswer(askResult?.answer, Boolean(askResult && !askPending));

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

  const conf = askResult ? confidenceLabel(askResult.confidence) : null;
  const showAnswer = panelOpen && (askPending || askResult);

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
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-indigo-200">
                  {askPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </span>
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
              <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-300/80">
                    Recall
                  </p>
                  {askResult?.question && (
                    <p className="mt-1 truncate text-sm text-white/45">“{askResult.question}”</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {voice.supported && askResult && !askPending && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (voice.speaking) voice.stop();
                          else voice.replay();
                        }}
                        className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                        aria-label={voice.speaking ? "Stop speaking" : "Read answer aloud"}
                        title={voice.speaking ? "Stop" : "Read aloud"}
                      >
                        <Volume2 size={18} className={voice.speaking ? "text-indigo-300" : undefined} />
                      </button>
                      <button
                        type="button"
                        onClick={() => voice.setVoiceEnabled(!voice.enabled)}
                        className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                        aria-label={voice.enabled ? "Mute voice answers" : "Enable voice answers"}
                        title={voice.enabled ? "Mute voice answers" : "Enable voice answers"}
                      >
                        {voice.enabled ? (
                          <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                            Voice
                          </span>
                        ) : (
                          <VolumeX size={18} />
                        )}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={closePanel}
                    className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 recall-scrollbar">
                <div className="mb-3 flex flex-wrap gap-2">
                  {conf && askResult && askResult.confidence > 0 && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${conf.className}`}>
                      {conf.label} · {Math.round(askResult.confidence * 100)}%
                    </span>
                  )}
                  {askResult?.privacy && (
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/50">
                      {privacyChipLabel(askResult.privacy)}
                    </span>
                  )}
                </div>

                <p className="whitespace-pre-wrap text-base leading-relaxed text-white/90 md:text-lg">
                  {askPending ? "Listening to your world…" : askResult?.answer}
                </p>

                {askResult?.caveats && (
                  <p className="mt-4 text-sm text-amber-200/80">⚠ {askResult.caveats}</p>
                )}

                {askResult && askResult.evidence.length > 0 && (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                      <ShieldCheck size={12} className="text-indigo-300" />
                      Evidence
                    </p>
                    <div className="space-y-2">
                      {askResult.evidence.slice(0, 4).map((ev) => {
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
                          <div key={ev.id}>
                            <p className="line-clamp-2 text-xs text-white/50">{ev.evidenceText}</p>
                            {href && (
                              <Link
                                href={href}
                                className="mt-0.5 inline-block text-[11px] text-indigo-300 no-underline hover:underline"
                              >
                                Open {relatedType}
                              </Link>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {askResult?.suggestedNextAction && (
                  <p className="mt-4 flex items-center gap-1.5 text-sm text-indigo-200">
                    <ArrowRight size={14} />
                    {askResult.suggestedNextAction}
                  </p>
                )}
              </div>
            </article>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
