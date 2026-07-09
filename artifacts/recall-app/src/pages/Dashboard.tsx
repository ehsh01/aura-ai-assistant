import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  listCaptureInbox,
  listProjects,
  useAiChat,
} from "@workspace/api-client-react";
import { fetchHome, ingestCapture, type HomeBriefingResponse } from "@/lib/recall-api";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { toast } from "@/hooks/use-toast";
import {
  resolveNotesForAi,
  tasksForAiContext,
  type RecallCaptureItem,
  type RecallProject,
} from "@/lib/recall-context";
import { notesPath } from "@/lib/recall-nav";
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
import { DontForgetSection } from "@/components/home/DontForgetSection";
import { RecallInsightsSection } from "@/components/home/RecallInsightsSection";
import { CurrentContextSection } from "@/components/home/CurrentContextSection";
import { BrainDumpInput } from "@/components/home/BrainDumpInput";

function firstLineTitle(text: string, fallback = "Quick capture"): string {
  const line = text.trim().split(/\r?\n/).find(Boolean) ?? fallback;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function Dashboard() {
  const { user } = useAuth();
  const { notes, tasks, addNote, addTask } = useRecallData();
  const [, navigate] = useLocation();
  const userName = firstName(user?.name);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const [home, setHome] = useState<HomeBriefingResponse | null>(null);
  const aiChat = useAiChat();

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
  }, [refreshHome]);

  const handleAskRecall = async (text: string) => {
    const q = text.trim();
    if (!q || aiChat.isPending) return;
    setAiReply(null);
    try {
      const res = await aiChat.mutateAsync({
        data: {
          messages: [{ role: "user", content: q }],
          context: {
            userName,
            tasks: tasksForAiContext(tasks),
            notes: resolveNotesForAi({ notes, searchQuery: q }),
          },
        },
      });
      if (res.openNote?.id) {
        navigate(notesPath({ noteId: res.openNote.id }));
        return;
      }
      setAiReply(res.message.content);
    } catch {
      setAiReply("Could not reach Recall AI. Check that you are signed in and try again.");
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
      // Async capture pipeline: stores the raw capture and queues AI extraction.
      await ingestCapture({
        rawText: body,
        sourceType: "manual",
        title: firstLineTitle(body),
      });
      toast({
        title: "Sent to AI Inbox",
        description: "Recall is analyzing it — check the inbox in a moment.",
      });
      refreshCaptures();
      refreshHome();
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

  return (
    <AppLayout>
      <div className="nebula-bg h-full overflow-y-auto text-zinc-100 dashboard-hide-scrollbar">
        <div className="orb-1 nebula-orb" />
        <div className="orb-3 nebula-orb" />

        <div className="relative z-10 mx-auto w-full max-w-5xl space-y-6 px-4 pb-44 pt-6 md:px-8 md:pt-8">
          <DailyBriefingCard briefing={briefing} date={date} />

          {(aiChat.isPending || aiReply) && (
            <div className="nebula-glass rounded-2xl border border-indigo-500/20 px-5 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-400" />
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-indigo-300/80">Recall</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                    {aiChat.isPending ? "Thinking…" : aiReply}
                  </p>
                </div>
              </div>
            </div>
          )}

          <FocusNowCard focus={focus} />

          <TimelineSection entries={timeline} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WaitingOnSection items={waiting} />
            <RecallInsightsSection insights={insights} />
          </div>

          <DontForgetSection items={dontForget} />

          <CurrentContextSection areas={contextAreas} />
        </div>
      </div>

      <BrainDumpInput
        aiPending={aiChat.isPending}
        onAsk={(text) => void handleAskRecall(text)}
        onSaveNote={handleSaveNote}
        onSaveTask={handleSaveTask}
        onSendInbox={(text) => void handleSendInbox(text)}
      />
    </AppLayout>
  );
}
