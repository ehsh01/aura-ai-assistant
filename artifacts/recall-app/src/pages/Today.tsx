import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects } from "@workspace/api-client-react";
import {
  listAttention,
  listHomeyAlerts,
  listPeople,
  listWaitingOn,
  type AttentionItemRecord,
  type HomeBriefingResponse,
  type PersonRecord,
  type WaitingOnRecord,
} from "@/lib/recall-api";
import { loadHome } from "@/lib/home-cache";
import { pressingFeed, type HomeyUrgencyAlert } from "@/lib/urgency";
import { ingestCaptureReliable } from "@/lib/capture-queue";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { toast } from "@/hooks/use-toast";
import { type RecallCaptureItem, type RecallProject } from "@/lib/recall-context";
import { askPath, notesPath, readSearchParam } from "@/lib/recall-nav";
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
import { NeedsReviewStrip } from "@/components/home/NeedsReviewStrip";
import { MorningBriefingCard } from "@/components/home/MorningBriefingCard";
import { EveningCheckinCard } from "@/components/home/EveningCheckinCard";
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
    sourceType: w.sourceType,
    ...(w.dueReason ? { dueReason: w.dueReason } : {}),
    trackedId: w.id.startsWith("durable:") ? w.id.slice("durable:".length) : null,
  }));
}

function firstLineTitle(text: string, fallback = "Quick capture"): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/** Merge ?capture= (internal deep link) with PWA share-target params into one prefill. */
function readCapturePrefillParams(): string | null {
  const parts = ["capture", "title", "text", "url"]
    .map((key) => readSearchParam(key)?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n") : null;
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
  const [capturePrefill, setCapturePrefill] = useState<string | null>(() =>
    readCapturePrefillParams(),
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
    // Shared cache: one /home fetch also feeds the nav review badges.
    void loadHome({ force: true })
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
    const raw = readCapturePrefillParams();
    if (!raw?.trim()) return;
    setCapturePrefill(raw);
    const url = new URL(window.location.href);
    for (const key of ["capture", "title", "text", "url"]) {
      url.searchParams.delete(key);
    }
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

  // Morning briefing actions skip anything the action queue already shows.
  const queuedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const q of queue) {
      ids.add(q.id);
      if (q.attention) ids.add(q.attention.id);
      if (q.waiting?.trackedId) ids.add(q.waiting.trackedId);
    }
    return ids;
  }, [queue]);

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
          <NeuralBrainBackground
            graph={brainGraph}
            opacity={0.22}
            density={0.75}
            speed={0.6}
            intensity={0.7}
          />
          <div className="orb-1 nebula-orb opacity-20" />
          <div className="orb-3 nebula-orb opacity-10" />
        </div>

        <div className="relative z-10 h-full overflow-y-auto dashboard-hide-scrollbar">
          <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-44 pt-6 md:px-8 md:pt-10">
            <header>
              <h1 className="text-3xl font-semibold text-white">Today</h1>
              <p className="mt-2 text-sm text-white/45">{countLabel}</p>
            </header>

            {home?.morning && (
              <MorningBriefingCard
                briefing={home.morning}
                queuedIds={queuedIds}
                userName={userName}
              />
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

            {home?.review && home.review.total > 0 && (
              <NeedsReviewStrip review={home.review} onChanged={refreshHome} />
            )}

            <TodayActionQueue
              items={queue}
              onWaitingChanged={refreshHome}
              onAttentionChanged={refreshAttention}
            />

            {dontForget.length > 0 && <DontForgetSection items={dontForget} />}

            <EveningCheckinCard onChanged={refreshHome} />
          </div>
        </div>
      </div>

      <BrainDumpInput
        initialText={capturePrefill}
        onAsk={(text) => navigate(askPath({ q: text }))}
        onSaveNote={handleSaveNote}
        onSaveTask={handleSaveTask}
        onSendInbox={(text) => void handleSendInbox(text)}
      />
    </AppLayout>
  );
}
