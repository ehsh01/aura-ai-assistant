import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  fetchHome,
  listActivity,
  listPeople,
  queryRecall,
  type ActivityRecord,
  type EvidenceRecord,
  type HomeBriefingResponse,
  type PersonRecord,
} from "@/lib/recall-api";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { toast } from "@/hooks/use-toast";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { askPath, entityPath, notesPath, readSearchParam } from "@/lib/recall-nav";
import {
  buildContextAreas,
  buildDailyBriefing,
  buildDontForget,
  buildFocusNow,
  buildInsights,
  buildTimeline,
  buildWaitingOn,
} from "@/lib/home-briefing";
import { DailyBriefingCard } from "@/components/home/DailyBriefingCard";
import { FocusNowCard } from "@/components/home/FocusNowCard";
import { TimelineSection } from "@/components/home/TimelineSection";
import { WaitingOnSection } from "@/components/home/WaitingOnSection";
import { MorningActions } from "@/components/home/MorningActions";
import { DontForgetSection } from "@/components/home/DontForgetSection";
import { RecallInsightsSection } from "@/components/home/RecallInsightsSection";
import { CurrentContextSection } from "@/components/home/CurrentContextSection";
import { FinanceSnapshotCard } from "@/components/home/FinanceSnapshotCard";
import { BrainDumpInput } from "@/components/home/BrainDumpInput";
import { NeuralBrainBackground } from "@/components/NeuralBrainBackground";

function firstLineTitle(text: string, fallback = "Quick capture"): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

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

export function Dashboard() {
  const { user } = useAuth();
  const { notes, tasks, addNote, addTask } = useRecallData();
  const [, navigate] = useLocation();
  const userName = firstName(user?.name);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askPending, setAskPending] = useState(false);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [home, setHome] = useState<HomeBriefingResponse | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [capturePrefill, setCapturePrefill] = useState<string | null>(() =>
    readSearchParam("capture"),
  );

  const refreshCaptures = () =>
    void listCaptureInbox()
      .then((res) => setCaptures(res.items as RecallCaptureItem[]))
      .catch(() => {});

  // Server-computed daily briefing (real data + AI hero). Falls back to the
  // client heuristics below if the request fails (e.g. offline).
  const refreshHome = useCallback(() => {
    void fetchHome()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    refreshHome();
    refreshCaptures();
    void listProjects().then((res) => setProjects(res.projects as RecallProject[])).catch(() => {});
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
    void listActivity({ limit: 6 })
      .then((res) => setActivity(res.items))
      .catch(() => setActivity([]));
  }, [refreshHome]);

  // Deep link: /?capture=text — prefill the brain-dump bar, then strip the param.
  useEffect(() => {
    const raw = readSearchParam("capture");
    if (!raw?.trim()) return;
    setCapturePrefill(raw);
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", next);
  }, []);

  const handleAskRecall = async (text: string) => {
    const q = text.trim();
    if (!q || askPending) return;
    setAskPending(true);
    setAskResult(null);
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
        answer: "Could not reach Recall AI. Check that you are signed in and try again.",
        confidence: 0,
        caveats: null,
        evidence: [],
        suggestedNextAction: null,
      });
    } finally {
      setAskPending(false);
    }
  };

  const handleSaveNote = (text: string) => {
    const body = text.trim();
    if (!body) return;
    const note = addNote({ title: firstLineTitle(body), content: body, tags: ["capture"] });
    toast({ title: "Note saved", description: "Opening it so you can review or edit." });
    navigate(notesPath({ noteId: note.id }));
  };

  const handleSaveTask = (text: string) => {
    const body = text.trim();
    if (!body) return;
    addTask(firstLineTitle(body));
    toast({ title: "Task added", description: "Added to your tasks." });
    refreshHome();
  };

  const handleSendInbox = async (text: string) => {
    const body = text.trim();
    if (!body) return;
    try {
      const result = await ingestCaptureReliable({
        rawText: body,
        sourceType: "manual",
        title: firstLineTitle(body),
      });
      if (result.queued) {
        toast({
          title: "Saved offline",
          description: "Will sync to AI Inbox when you're back online.",
        });
      } else {
        toast({
          title: "Sent to AI Inbox",
          description: "Recall is analyzing it — check the inbox in a moment.",
        });
        refreshCaptures();
        refreshHome();
      }
    } catch {
      toast({ title: "Could not send to inbox", variant: "destructive" });
    }
  };

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Prefer the server-computed briefing; fall back to client heuristics offline.
  const date = home?.date ?? currentDate;
  const briefing = home?.briefing ?? buildDailyBriefing(userName, tasks, notes, captures, projects);
  const focus = home?.focus ?? buildFocusNow(tasks, projects);
  const timeline = home?.timeline ?? buildTimeline(tasks, captures);
  const waiting = home?.waiting ?? buildWaitingOn(notes);
  const dontForget = home?.dontForget ?? buildDontForget(notes, captures);
  const insights = home?.insights ?? buildInsights(tasks, notes, captures, projects);
  const contextAreas = home?.contextAreas ?? buildContextAreas(notes, tasks, captures, projects);
  const finance = home?.finance ?? null;
  const conf = askResult ? confidenceLabel(askResult.confidence) : null;

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

  return (
    <AppLayout>
      <div className="nebula-bg relative h-full text-zinc-100">
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <NeuralBrainBackground graph={brainGraph} opacity={0.5} />
          <div className="orb-1 nebula-orb opacity-35" />
          <div className="orb-3 nebula-orb opacity-25" />
        </div>

        <div className="relative z-10 h-full overflow-y-auto dashboard-hide-scrollbar">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-44 pt-6 md:px-8 md:pt-8">
          <DailyBriefingCard briefing={briefing} date={date} />

          <MorningActions focus={focus} waiting={waiting} briefing={briefing} />

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/ask"
              className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 no-underline hover:bg-indigo-500/20"
            >
              <Sparkles size={14} />
              Ask Recall
              <ArrowRight size={12} />
            </Link>
            <Link
              href="/memory"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 no-underline hover:bg-white/5 hover:text-white/80"
            >
              Teach Recall
            </Link>
            <Link
              href="/ask?q=What%20do%20you%20know%20about%20my%20life%3F"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 no-underline hover:bg-white/5 hover:text-white/80"
            >
              Ask about my life
            </Link>
            <Link
              href="/inbox"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 no-underline hover:bg-white/5 hover:text-white/80"
            >
              Inbox
            </Link>
            <Link
              href="/people"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 no-underline hover:bg-white/5 hover:text-white/80"
            >
              People
            </Link>
            <Link
              href="/activity"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 no-underline hover:bg-white/5 hover:text-white/80"
            >
              Activity
            </Link>
          </div>

          {(askPending || askResult) && (
            <div className="nebula-glass rounded-2xl border border-indigo-500/20 px-5 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-400" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-indigo-300/80">Recall</p>
                    {conf && askResult && askResult.confidence > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${conf.className}`}>
                        {conf.label} · {Math.round(askResult.confidence * 100)}%
                      </span>
                    )}
                    {askResult?.privacy && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/50">
                        {privacyChipLabel(askResult.privacy)}
                      </span>
                    )}
                  </div>
                  {askResult?.question && (
                    <p className="mb-2 text-xs text-white/40">“{askResult.question}”</p>
                  )}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                    {askPending ? "Thinking…" : askResult?.answer}
                  </p>
                  {askResult?.caveats && (
                    <p className="mt-2 text-xs text-amber-200/80">⚠ {askResult.caveats}</p>
                  )}
                  {askResult && askResult.evidence.length > 0 && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                        <ShieldCheck size={12} className="text-indigo-300" />
                        Evidence ({askResult.evidence.length})
                      </p>
                      <div className="space-y-1.5">
                        {askResult.evidence.slice(0, 3).map((ev) => {
                          const relatedType =
                            typeof ev.evidenceMetadata?.relatedEntityType === "string"
                              ? ev.evidenceMetadata.relatedEntityType
                              : ev.entityType;
                          const relatedId =
                            typeof ev.evidenceMetadata?.relatedEntityId === "string"
                              ? ev.evidenceMetadata.relatedEntityId
                              : ev.entityId;
                          const href = entityPath(relatedType, relatedId);
                          const personName =
                            typeof ev.evidenceMetadata?.personName === "string"
                              ? ev.evidenceMetadata.personName
                              : typeof ev.evidenceMetadata?.person === "string"
                                ? ev.evidenceMetadata.person
                                : null;
                          const personId =
                            typeof ev.evidenceMetadata?.personId === "string"
                              ? ev.evidenceMetadata.personId
                              : null;
                          return (
                            <div key={ev.id} className="space-y-0.5">
                              <p className="line-clamp-2 text-xs text-white/50">
                                {ev.evidenceText}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {href && (
                                  <Link
                                    href={href}
                                    className="text-[11px] text-indigo-300 no-underline hover:underline"
                                  >
                                    Open {relatedType}
                                  </Link>
                                )}
                                {personName && (
                                  <Link
                                    href={
                                      personId
                                        ? entityPath("person", personId) ?? "/people"
                                        : "/people"
                                    }
                                    className="text-[11px] text-sky-300 no-underline hover:underline"
                                  >
                                    {personName}
                                  </Link>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {askResult?.suggestedNextAction && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-indigo-200">
                      <ArrowRight size={12} />
                      {askResult.suggestedNextAction}
                    </p>
                  )}
                  <Link
                    href={
                      askResult?.question
                        ? askPath({ q: askResult.question })
                        : "/ask"
                    }
                    className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-300 no-underline hover:underline"
                  >
                    Open full Ask page
                    <ArrowRight size={11} />
                  </Link>
                </div>
              </div>
            </div>
          )}

          <FocusNowCard focus={focus} />

          <FinanceSnapshotCard finance={finance} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WaitingOnSection items={waiting} />
            <RecentActivityCard items={activity} />
          </div>

          <TimelineSection entries={timeline} />

          <RecallInsightsSection insights={insights} />

          <DontForgetSection items={dontForget} />

          <CurrentContextSection areas={contextAreas} />
        </div>
        </div>
      </div>

      <BrainDumpInput
        aiPending={askPending}
        initialText={capturePrefill}
        onAsk={(text) => void handleAskRecall(text)}
        onSaveNote={handleSaveNote}
        onSaveTask={handleSaveTask}
        onSendInbox={(text) => void handleSendInbox(text)}
      />
    </AppLayout>
  );
}
