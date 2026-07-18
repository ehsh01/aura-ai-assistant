import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  fetchHome,
  getWeeklyDigest,
  listAttention,
  listHomeyAlerts,
  listPeople,
  listWaitingOn,
  type AttentionItemRecord,
  type HomeBriefingResponse,
  type PersonRecord,
  type WaitingOnRecord,
} from "@/lib/recall-api";
import { pressingFeed, type HomeyUrgencyAlert } from "@/lib/urgency";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { toast } from "@/hooks/use-toast";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { notesPath, readSearchParam } from "@/lib/recall-nav";
import {
  buildDailyBriefing,
  buildDontForget,
  buildFocusNow,
  type WaitingItem,
} from "@/lib/home-briefing";
import { filterDismissedWaiting } from "@/lib/waiting-dismissals";
import {
  buildTodayQueue,
  TodayActionQueue,
} from "@/components/home/TodayActionQueue";
import { DontForgetSection } from "@/components/home/DontForgetSection";
import { BrainDumpInput } from "@/components/home/BrainDumpInput";
import { NeuralBrainBackground } from "@/components/NeuralBrainBackground";

function toWaitingItems(items: WaitingOnRecord[]): WaitingItem[] {
  return items.map((w) => ({
    id: w.id,
    person: w.person,
    personId: w.personId,
    item: w.item,
    days: w.days,
    href: w.href,
    followUp: w.followUp,
  }));
}

function firstLineTitle(text: string, fallback = "Quick capture"): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/** One queue of things you can act on — nothing else. */
export function Today() {
  const { user } = useAuth();
  const { notes, tasks, addNote, addTask } = useRecallData();
  const [, navigate] = useLocation();
  const userName = firstName(user?.name);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [home, setHome] = useState<HomeBriefingResponse | null>(null);
  const [waiting, setWaiting] = useState<WaitingItem[]>([]);
  const [attention, setAttention] = useState<AttentionItemRecord[]>([]);
  const [homeyAlerts, setHomeyAlerts] = useState<HomeyUrgencyAlert[]>([]);
  const [weeklyDigest, setWeeklyDigest] = useState<{
    weekOf: string;
    summary: string;
    sections: { title: string; bullets: string[] }[];
  } | null>(null);
  const [digestDismissed, setDigestDismissed] = useState(() => {
    try {
      return localStorage.getItem("recall-weekly-digest-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [capturePrefill, setCapturePrefill] = useState<string | null>(() =>
    readSearchParam("capture"),
  );

  const refreshCaptures = () =>
    void listCaptureInbox()
      .then((res) => setCaptures(res.items as RecallCaptureItem[]))
      .catch(() => {});

  const refreshWaiting = useCallback(() => {
    void listWaitingOn()
      .then((res) => setWaiting(filterDismissedWaiting(toWaitingItems(res.items))))
      .catch(() => {
        // Keep last good server list — never rebuild from local notes (ignores dismissals).
      });
  }, []);

  const refreshAttention = useCallback(() => {
    void listAttention()
      .then((res) => setAttention(res.items ?? []))
      .catch(() => {
        /* keep last good list */
      });
  }, []);

  const refreshHome = useCallback(() => {
    void fetchHome()
      .then((next) => {
        setHome(next);
        if (Array.isArray(next.waiting)) {
          setWaiting(filterDismissedWaiting(next.waiting));
        }
      })
      .catch(() => {
        // Keep prior home snapshot; a failed refresh must not wipe dismiss-aware waiting.
      });
    refreshWaiting();
    refreshAttention();
  }, [refreshWaiting, refreshAttention]);

  useEffect(() => {
    refreshHome();
    refreshCaptures();
    void listProjects()
      .then((res) => setProjects(res.projects as RecallProject[]))
      .catch(() => {});
    void listPeople()
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
    void getWeeklyDigest()
      .then((d) => setWeeklyDigest(d))
      .catch(() => setWeeklyDigest(null));
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

  const briefing =
    home?.briefing ??
    buildDailyBriefing(userName, tasks, notes, captures, projects, homeyAlerts);
  const focus = home?.focus ?? buildFocusNow(tasks, projects);
  const pressing = useMemo(
    () => pressingFeed(tasks, notes, captures, 6, homeyAlerts),
    [tasks, notes, captures, homeyAlerts],
  );

  const queue = useMemo(
    () =>
      buildTodayQueue({
        focus,
        waiting: filterDismissedWaiting(waiting),
        critical: briefing.critical,
        reminders: briefing.reminders,
        attention,
      }),
    [focus, waiting, briefing.critical, briefing.reminders, attention],
  );

  // Don't re-surface items already in the action queue.
  const dontForget = useMemo(() => {
    const queued = new Set(
      queue.flatMap((q) => [q.title.toLowerCase(), q.href]),
    );
    return (home?.dontForget ?? buildDontForget(notes, captures))
      .filter(
        (item) =>
          !queued.has(item.label.toLowerCase()) && !queued.has(item.href),
      )
      .slice(0, 5);
  }, [home?.dontForget, notes, captures, queue]);

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

  const countLabel =
    queue.length === 0
      ? "Nothing queued"
      : queue.length === 1
        ? "1 thing to handle"
        : `${queue.length} things to handle`;

  return (
    <AppLayout>
      <div className="nebula-bg relative h-full text-zinc-100">
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <NeuralBrainBackground graph={brainGraph} opacity={0.22} />
          <div className="orb-1 nebula-orb opacity-20" />
          <div className="orb-3 nebula-orb opacity-10" />
        </div>

        <div className="relative z-10 h-full overflow-y-auto dashboard-hide-scrollbar">
          <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-44 pt-6 md:px-8 md:pt-10">
            <header>
              <h1 className="text-3xl font-semibold text-white">Today</h1>
              <p className="mt-2 text-sm text-white/45">{countLabel}</p>
            </header>

            {weeklyDigest && !digestDismissed && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                      This week
                    </p>
                    <p className="mt-1 text-sm text-white/70">{weeklyDigest.summary}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-white/35 hover:text-white/60"
                    onClick={() => {
                      setDigestDismissed(true);
                      try {
                        localStorage.setItem("recall-weekly-digest-dismissed", "1");
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    Dismiss
                  </button>
                </div>
                <ul className="mt-3 space-y-2">
                  {weeklyDigest.sections.slice(0, 3).map((s) => (
                    <li key={s.title}>
                      <p className="text-xs text-white/40">{s.title}</p>
                      <p className="text-sm text-white/65">{s.bullets[0]}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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
                        <Link
                          href="/connectors"
                          className="text-zinc-200 no-underline hover:text-amber-100"
                        >
                          <span className="text-amber-300/80">{item.reason}</span>
                          {" · "}
                          {item.title}
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <TodayActionQueue
              items={queue}
              onWaitingChanged={refreshHome}
              onAttentionChanged={refreshAttention}
            />

            {dontForget.length > 0 && <DontForgetSection items={dontForget} />}
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
