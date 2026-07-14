import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  fetchHome,
  listActivity,
  listHomeyAlerts,
  listPeople,
  type ActivityRecord,
  type HomeBriefingResponse,
  type PersonRecord,
} from "@/lib/recall-api";
import { pressingFeed, type HomeyUrgencyAlert } from "@/lib/urgency";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { toast } from "@/hooks/use-toast";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { notesPath, readSearchParam } from "@/lib/recall-nav";
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

/** Pending work, briefing, and capture — the former Home dashboard. */
export function Today() {
  const { user } = useAuth();
  const { notes, tasks, addNote, addTask } = useRecallData();
  const [, navigate] = useLocation();
  const userName = firstName(user?.name);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [home, setHome] = useState<HomeBriefingResponse | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [homeyAlerts, setHomeyAlerts] = useState<HomeyUrgencyAlert[]>([]);
  const [capturePrefill, setCapturePrefill] = useState<string | null>(() =>
    readSearchParam("capture"),
  );

  const refreshCaptures = () =>
    void listCaptureInbox()
      .then((res) => setCaptures(res.items as RecallCaptureItem[]))
      .catch(() => {});

  const refreshHome = useCallback(() => {
    void fetchHome()
      .then(setHome)
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    refreshHome();
    refreshCaptures();
    void listProjects()
      .then((res) => setProjects(res.projects as RecallProject[]))
      .catch(() => {});
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
    void listActivity({ limit: 6 })
      .then((res) => setActivity(res.items))
      .catch(() => setActivity([]));
    void listHomeyAlerts()
      .then((res) =>
        setHomeyAlerts(
          res.alerts.map((a) => ({
            id: a.id,
            title: a.title,
            severity: a.severity,
            deviceName: a.deviceName,
          })),
        ),
      )
      .catch(() => setHomeyAlerts([]));
  }, [refreshHome]);

  useEffect(() => {
    const raw = readSearchParam("capture");
    if (!raw?.trim()) return;
    setCapturePrefill(raw);
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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

  const date = home?.date ?? currentDate;
  const briefing =
    home?.briefing ??
    buildDailyBriefing(userName, tasks, notes, captures, projects, homeyAlerts);
  const focus = home?.focus ?? buildFocusNow(tasks, projects);
  const pressing = useMemo(
    () => pressingFeed(tasks, notes, captures, 6, homeyAlerts),
    [tasks, notes, captures, homeyAlerts],
  );
  const timeline = home?.timeline ?? buildTimeline(tasks, captures);
  const waiting = home?.waiting ?? buildWaitingOn(notes);
  const dontForget = home?.dontForget ?? buildDontForget(notes, captures);
  const insights = home?.insights ?? buildInsights(tasks, notes, captures, projects);
  const contextAreas = home?.contextAreas ?? buildContextAreas(notes, tasks, captures, projects);
  const finance = home?.finance ?? null;

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
          <NeuralBrainBackground graph={brainGraph} opacity={0.28} />
          <div className="orb-1 nebula-orb opacity-25" />
          <div className="orb-3 nebula-orb opacity-15" />
        </div>

        <div className="relative z-10 h-full overflow-y-auto dashboard-hide-scrollbar">
          <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-44 pt-6 md:px-8 md:pt-8">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">Focus</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Today</h1>
              <p className="mt-2 text-white/45">
                What needs you now — briefing, waiting, and pending work.
              </p>
            </div>

            <DailyBriefingCard briefing={briefing} date={date} />
            {pressing.some((p) => p.kind === "homey") && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-200/70">
                  Home alerts
                </p>
                <ul className="mt-2 space-y-1.5">
                  {pressing
                    .filter((p) => p.kind === "homey")
                    .map((item) => (
                      <li key={item.key} className="text-sm text-zinc-200">
                        <span className="text-amber-300/80">{item.reason}</span>
                        {" · "}
                        {item.title}
                      </li>
                    ))}
                </ul>
              </section>
            )}
            <MorningActions focus={focus} waiting={waiting} briefing={briefing} />
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
        initialText={capturePrefill}
        onAsk={(text) => navigate(`/?q=${encodeURIComponent(text.trim())}`)}
        onSaveNote={handleSaveNote}
        onSaveTask={handleSaveTask}
        onSendInbox={(text) => void handleSendInbox(text)}
      />
    </AppLayout>
  );
}
