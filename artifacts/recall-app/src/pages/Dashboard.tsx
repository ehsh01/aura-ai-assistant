import React, { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { listCaptureInbox, listProjects, useDashboardDigest, useAiChat } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import {
  notesForAiContext,
  resolveNotesForAi,
  tasksForAiContext,
  type RecallCaptureItem,
  type RecallProject,
} from "@/lib/recall-context";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { Search, Bell, Calendar, CheckCircle2, Circle, MoreHorizontal, MessageSquare, Sparkles, Pin, Plus, CheckSquare, FileText, Clock, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { MicButton } from "@/components/MicButton";
import { notesPath, tasksPath } from "@/lib/recall-nav";
import {
  personalProjects,
  thingsYouMayForget,
  urgentTasks,
  waitingNotes,
  workFollowUps,
} from "@/lib/urgency";

const DEFAULT_DIGEST =
  '"Clarity comes from action, not thought. Here\'s what needs your attention today."';

export function Dashboard() {
  const { user } = useAuth();
  const { notes, tasks } = useRecallData();
  const userName = firstName(user?.name);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [digestText, setDigestText] = useState<string | null>(null);
  const [digestHighlights, setDigestHighlights] = useState<string[]>([]);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [captures, setCaptures] = useState<RecallCaptureItem[]>([]);
  const [projects, setProjects] = useState<RecallProject[]>([]);
  const digestMutation = useDashboardDigest();
  const aiChat = useAiChat();

  useEffect(() => {
    void listCaptureInbox().then((res) => setCaptures(res.items as RecallCaptureItem[])).catch(() => {});
    void listProjects().then((res) => setProjects(res.projects as RecallProject[])).catch(() => {});
  }, []);

  const handleGenerateDigest = () => {
    digestMutation.mutate(
      {
        data: {
          userName,
          tasks: tasksForAiContext(tasks),
          notes: notesForAiContext(notes, 20),
        },
      },
      {
        onSuccess: (data) => {
          setDigestText(data.digest);
          setDigestHighlights(data.highlights);
        },
      },
    );
  };

  const handleAskRecall = async (text?: string) => {
    const q = (text ?? searchQuery).trim();
    if (!q || aiChat.isPending) return;
    setSearchQuery("");
    setAiReply(null);
    try {
      const res = await aiChat.mutateAsync({
        data: {
          messages: [{ role: "user", content: q }],
          context: {
            userName,
            tasks: tasksForAiContext(tasks),
            notes: notesForAiContext(notes, 20),
          },
        },
      });
      setAiReply(res.message.content);
    } catch {
      setAiReply("Could not reach Recall AI. Check that you are signed in and try again.");
    }
  };

  const stats = [
    {
      id: 1,
      value: String(tasks.filter((t) => !t.completed).length),
      label: "tasks due",
      href: tasksPath(),
      icon: <CheckSquare className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 2,
      value: String(notes.length),
      label: "notes",
      href: notesPath(),
      icon: <FileText className="w-5 h-5 text-indigo-400" />,
    },
    {
      id: 3,
      value: String(notes.filter((n) => n.pinned).length),
      label: "pinned",
      href: notesPath({ pinned: true }),
      icon: <Clock className="w-5 h-5 text-pink-400" />,
    },
  ];

  const pinnedNotes = notes.filter((n) => n.pinned).slice(0, 2);
  const recentNotes = notes.filter((n) => !n.pinned).slice(0, 4);
  const upcomingTasks = tasks.filter((t) => !t.completed).slice(0, 4);
  const urgentToday = urgentTasks(tasks, 5);
  const waiting = waitingNotes(notes, 5);
  const followUps = workFollowUps(notes, tasks, 5);
  const projectFocus = personalProjects(projects, 5);
  const forgetList = thingsYouMayForget(notes, captures, 5);

  const aiConversations = notes.length
    ? [`Summarize my note "${notes[0]?.title}"`, "What should I focus on today?", "Help me plan my week"]
    : ["What can Recall help me with?", "How do I add my first note?", "What should I focus on today?"];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.6)]";
      case "med":
      case "medium": return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
      case "low": return "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.6)]";
      default: return "bg-zinc-500";
    }
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <AppLayout>
      <div className="nebula-bg flex flex-col h-full text-zinc-100 font-sans">
        {/* Background Orbs */}
        <div className="orb-1 nebula-orb"></div>
        <div className="orb-2 nebula-orb"></div>
        <div className="orb-3 nebula-orb"></div>
        <div className="orb-4 nebula-orb"></div>

        {/* Top Header */}
        <header className="flex-none px-8 py-6 flex items-center justify-between z-20 relative">
          <div className="flex items-center gap-4">
            {/* Glowing Logo */}
            <div className="w-10 h-10 rounded-2xl nebula-glass flex items-center justify-center shadow-[0_0_20px_rgba(124,58,237,0.4)]">
              <Sparkles className="w-6 h-6 text-indigo-300" />
            </div>
          </div>

          <div className="flex-1 max-w-xl mx-8">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAskRecall();
              }}
              className={`nebula-glass rounded-full px-5 py-3 flex items-center transition-all duration-300 nebula-search-container ${searchFocused ? "bg-white/[0.08]" : ""}`}
            >
              {aiChat.isPending ? (
                <Loader2 className="w-5 h-5 mr-3 text-indigo-300 animate-spin flex-shrink-0" />
              ) : (
                <Search className={`w-5 h-5 mr-3 transition-colors flex-shrink-0 ${searchFocused ? "text-indigo-300" : "text-zinc-400"}`} />
              )}
              <input
                type="text"
                placeholder="Ask Recall anything..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={aiChat.isPending}
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-500 w-full font-medium"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </form>
          </div>

          <div className="flex items-center gap-6">
            <MicButton
              onTranscript={(text) => void handleAskRecall(text)}
              className="relative w-14 h-14 rounded-full bg-indigo-500/20 text-indigo-200 flex items-center justify-center border border-indigo-400/30 hover:bg-indigo-500/30 transition-colors group cursor-pointer nebula-float mic-halo mic-pulse z-30"
              iconSize={24}
              title="Ask Recall with your voice"
            />

            <button className="w-10 h-10 rounded-full nebula-glass flex items-center justify-center text-zinc-300 hover:text-white transition-colors relative z-20">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-pink-500 rounded-full shadow-[0_0_5px_rgba(236,72,153,0.8)]"></span>
            </button>
            
            <div className="w-10 h-10 rounded-full nebula-glass flex items-center justify-center text-sm font-bold text-indigo-200 z-20 shadow-[0_0_15px_rgba(99,102,241,0.3)] cursor-pointer">
              E
            </div>
          </div>
        </header>

        {(aiChat.isPending || aiReply) && (
          <div className="flex-none px-8 pb-2 z-20 relative">
            <div className="max-w-3xl mx-auto nebula-glass rounded-2xl px-5 py-4 border border-indigo-500/20">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-indigo-300/80 mb-1">Recall</p>
                  <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {aiChat.isPending ? "Thinking…" : aiReply}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 pt-4 z-10 relative dashboard-hide-scrollbar">
          <div className="max-w-6xl mx-auto space-y-12">
            
            {/* Greeting */}
            <section className="flex flex-col items-center text-center space-y-4">
              <h1 className="text-5xl md:text-6xl font-semibold tracking-tight text-gradient-nebula mb-2">
                Good morning, {userName} <span className="text-indigo-400 text-4xl inline-block ml-2 animate-pulse">✦</span>
              </h1>
              <div className="flex items-center gap-2 text-indigo-200/60 font-light tracking-wide text-sm">
                <Calendar className="w-4 h-4" />
                <span>{currentDate}</span>
              </div>
              <p className="text-lg text-zinc-300 italic font-light max-w-2xl mt-4 leading-relaxed mix-blend-screen">
                {digestMutation.isPending
                  ? "Recall is preparing your morning digest…"
                  : digestText ?? DEFAULT_DIGEST}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => handleGenerateDigest()}
                  disabled={digestMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm nebula-glass nebula-glass-hover text-indigo-200 disabled:opacity-50"
                >
                  {digestMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {digestText ? "Refresh digest" : "Generate morning digest"}
                </button>
                {notes.length > 0 && (
                  <Link
                    href={notesPath()}
                    className="text-sm text-zinc-400 hover:text-zinc-200 no-underline"
                  >
                    Search notes instead →
                  </Link>
                )}
              </div>
              {digestHighlights.length > 0 && (
                <ul className="text-sm text-zinc-400 space-y-1 max-w-xl">
                  {digestHighlights.map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* Stats Row */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {stats.map((stat) => (
                <Link
                  key={stat.id}
                  href={stat.href}
                  className="nebula-glass nebula-glass-hover rounded-3xl p-6 flex items-center gap-5 cursor-pointer block no-underline text-inherit"
                >
                  <div className="w-12 h-12 nebula-pill flex items-center justify-center flex-shrink-0">
                    {stat.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-3xl font-bold text-white tracking-tight">{stat.value}</span>
                    <span className="text-sm text-zinc-400 font-light uppercase tracking-wider">{stat.label}</span>
                  </div>
                </Link>
              ))}
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <UrgencyPanel title="Urgent Today" empty="Nothing urgent is flagged right now.">
                {urgentToday.map((task) => (
                  <Link key={task.id} href={tasksPath({ taskId: task.id })} className="block rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200 no-underline">
                    {task.title}
                  </Link>
                ))}
              </UrgencyPanel>
              <UrgencyPanel title="Recent Captures" empty="No pending captures.">
                {captures.slice(0, 5).map((item) => (
                  <Link key={item.id} href="/inbox" className="block rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200 no-underline">
                    <span className="block text-xs uppercase tracking-wider text-indigo-300/70">{item.suggestedType.replace("_", " ")}</span>
                    {item.cleanedTitle}
                  </Link>
                ))}
              </UrgencyPanel>
              <UrgencyPanel title="Things Recall Thinks You May Forget" empty="No memory risks detected from current items.">
                {forgetList.map((title) => (
                  <div key={title} className="rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200">
                    {title}
                  </div>
                ))}
              </UrgencyPanel>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <UrgencyPanel title="Waiting on Someone" empty="No waiting/follow-up notes found.">
                {waiting.map((note) => (
                  <Link key={note.id} href={notesPath({ noteId: note.id })} className="block rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200 no-underline">
                    {note.title}
                  </Link>
                ))}
              </UrgencyPanel>
              <UrgencyPanel title="Work Follow-ups" empty="No work follow-ups detected.">
                {followUps.map((item) => (
                  <Link key={`${item.kind}-${item.id}`} href={item.kind === "task" ? tasksPath({ taskId: item.id }) : notesPath({ noteId: item.id })} className="block rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200 no-underline">
                    {item.title}
                  </Link>
                ))}
              </UrgencyPanel>
              <UrgencyPanel title="Personal Projects" empty="No active projects yet.">
                {projectFocus.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`} className="block rounded-2xl bg-white/[0.05] p-4 text-sm text-zinc-200 no-underline">
                    {project.name}
                  </Link>
                ))}
              </UrgencyPanel>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Notes */}
              <div className="lg:col-span-8 space-y-8">
                
                {/* Pinned Notes */}
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-light text-zinc-200 flex items-center gap-3">
                      <div className="nebula-pill p-2"><Pin className="w-4 h-4 text-indigo-300" /></div> Pinned Context
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    {pinnedNotes.length === 0 && recentNotes.length === 0 && (
                      <p className="text-sm text-zinc-500 col-span-2 py-8 text-center">
                        No notes yet — open Notes and tap + to add your first one.
                      </p>
                    )}
                    {pinnedNotes.map((note, i) => (
                      <Link
                        key={note.id}
                        href={notesPath({ noteId: note.id })}
                        className={`nebula-glass nebula-glass-hover rounded-3xl p-6 flex flex-col h-56 transform ${i % 2 === 0 ? "rotate-1" : "-rotate-1"} transition-all duration-300 cursor-pointer block no-underline text-inherit`}
                        style={{ borderTop: `2px solid ${i % 2 === 0 ? "rgba(124, 58, 237, 0.5)" : "rgba(219, 39, 119, 0.5)"}` }}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="font-semibold text-lg text-zinc-100">{note.title}</h3>
                          <MoreHorizontal className="w-5 h-5 text-zinc-500" />
                        </div>
                        <p className="text-sm text-zinc-400 font-light leading-relaxed mb-auto line-clamp-3">
                          {note.preview}
                        </p>
                        <div className="flex items-center justify-between mt-4">
                          <span className="text-xs text-zinc-500 font-light">{note.date}</span>
                          <div className="flex gap-2">
                            {note.tags.map((tag) => (
                              <span key={tag} className="nebula-pill text-[10px] font-medium px-3 py-1 text-zinc-300">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </Link>
                    ))}
                    
                    {/* Add New Note Card - Floating */}
                    <div className="absolute -bottom-4 right-0 transform translate-y-1/2 translate-x-1/2 md:translate-x-0 z-20">
                       <Link
                         href={notesPath({ newNote: true })}
                         className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-[0_10px_30px_rgba(124,58,237,0.5)] hover:shadow-[0_15px_40px_rgba(124,58,237,0.7)] transition-all nebula-float group border border-white/20"
                         title="New note"
                       >
                          <Plus className="w-8 h-8 group-hover:scale-110 transition-transform" />
                       </Link>
                    </div>
                  </div>
                </section>

                {/* Recent Notes Strip */}
                <section className="pt-4">
                  <h2 className="text-sm font-light text-zinc-400 uppercase tracking-widest mb-4">Flow State</h2>
                  <div className="flex gap-4 overflow-x-auto dashboard-hide-scrollbar pb-4">
                    {recentNotes.map((note) => (
                      <Link
                        key={note.id}
                        href={notesPath({ noteId: note.id })}
                        className="flex-none w-56 nebula-glass nebula-glass-hover rounded-2xl p-4 cursor-pointer group block no-underline text-inherit"
                      >
                        <div className="flex flex-col h-full">
                          <div className="flex items-center justify-between mb-3">
                            <div className="w-8 h-8 nebula-pill flex items-center justify-center">
                              <FileText className="w-4 h-4 text-zinc-400 group-hover:text-indigo-300 transition-colors" />
                            </div>
                            <span className="text-xs text-zinc-500 font-light">{note.date}</span>
                          </div>
                          <h3 className="font-medium text-sm text-zinc-200 group-hover:text-white transition-colors line-clamp-2">{note.title}</h3>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
                
              </div>

              {/* Right Column: Tasks */}
              <div className="lg:col-span-4 space-y-8">
                <section className="nebula-glass rounded-3xl p-6 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-light text-zinc-200 flex items-center gap-3">
                      <div className="nebula-pill p-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /></div> Action Items
                    </h2>
                  </div>
                  
                  <div className="space-y-4 flex-1">
                    {upcomingTasks.map((task) => (
                      <Link
                        key={task.id}
                        href={tasksPath({ taskId: task.id })}
                        className="group flex items-start gap-4 p-4 nebula-glass rounded-2xl hover:border-indigo-500/30 transition-all cursor-pointer block no-underline text-inherit"
                      >
                        <span className="mt-0.5 text-zinc-500 group-hover:text-emerald-400 transition-colors flex-shrink-0">
                          <Circle className="w-5 h-5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{task.title}</p>
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${getPriorityColor(task.priority)}`} />
                      </Link>
                    ))}
                  </div>
                  
                  <Link href="/tasks">
                    <button className="w-full mt-6 py-3 rounded-2xl text-sm font-medium text-indigo-300 nebula-pill hover:bg-white/[0.12] hover:text-white transition-all cursor-pointer">
                      Open Tasks Panel
                    </button>
                  </Link>
                </section>
              </div>
            </div>

            {/* Bottom: Recent AI Conversations */}
            <section className="pt-8 pb-4">
              <h2 className="text-sm font-light text-zinc-400 uppercase tracking-widest mb-6 flex items-center gap-3">
                <div className="nebula-pill p-1.5"><MessageSquare className="w-3.5 h-3.5 text-pink-400" /></div> Recent with Recall
              </h2>
              <div className="flex flex-wrap gap-4">
                {aiConversations.map((conv, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void handleAskRecall(conv)}
                    className="nebula-glass nebula-glass-hover rounded-full px-5 py-3 text-sm text-zinc-200 cursor-pointer flex items-center gap-3 text-left"
                  >
                    <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <span className="truncate max-w-md font-light">{conv}</span>
                  </button>
                ))}
              </div>
            </section>
            
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function UrgencyPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const list = React.Children.toArray(children).filter(Boolean);
  return (
    <section className="nebula-glass rounded-3xl p-5">
      <h2 className="mb-4 text-sm font-light uppercase tracking-widest text-zinc-400">
        {title}
      </h2>
      {list.length > 0 ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </section>
  );
}
