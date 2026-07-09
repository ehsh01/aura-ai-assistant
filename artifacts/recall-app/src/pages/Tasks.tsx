import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { useAiChat, useGetAiStatus } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import {
  type RecallTask,
  tasksForAiContext,
} from "@/lib/recall-context";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import { askPath, notesPath, peoplePath, readSearchParam, tasksPath } from "@/lib/recall-nav";
import {
  Check,
  Circle,
  GripVertical,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  MoreHorizontal,
  Calendar,
  Clock,
  FileSearch,
} from "lucide-react";
import { MicButton } from "@/components/MicButton";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { TaskPersonPicker } from "@/components/TaskPersonPicker";
import { NoteTagList, parsePersonTag } from "@/components/PersonTagLink";
import { listPeople } from "@/lib/recall-api";

type Priority = RecallTask["priority"];

interface Task extends RecallTask {}

type ChatMsg = { role: "user" | "assistant"; content: string; time: string };

const PRIORITY_COLORS: Record<Priority, string> = {
  high: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]",
  med: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]",
  low: "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]",
  none: "bg-white/20"
};

function TaskItem({
  task,
  onToggle,
  onShowEvidence,
  onAssignPerson,
  onPersonTagClick,
  highlighted,
  itemRef,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onShowEvidence: (task: Task) => void;
  onAssignPerson: (
    taskId: string,
    next: { personId: string | null; personName: string | null },
  ) => void;
  onPersonTagClick?: (name: string) => void;
  highlighted?: boolean;
  itemRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={itemRef}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
        highlighted
          ? "border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/30"
          : "border-transparent hover:border-white/5 hover:bg-white/[0.02]"
      } ${task.completed ? "opacity-50" : ""}`}
    >
      <button className="text-white/20 cursor-grab hover:text-white/50 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical size={16} />
      </button>
      
      <button 
        onClick={() => onToggle(task.id)}
        className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${task.completed ? "bg-indigo-500 border-indigo-500" : "border-white/20 hover:border-indigo-400 hover:bg-indigo-500/10"}`}
      >
        {task.completed && <Check size={12} className="text-white" />}
      </button>
      
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className={`text-[15px] font-medium tracking-tight ${task.completed ? "line-through text-white/50" : "text-white/90"}`}>
            {task.title}
          </span>
          <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[task.priority]}`} />
        </div>
        
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 mt-1 text-[12px] text-white/40">
          {task.time && (
            <span className="flex items-center gap-1">
              <Clock size={12} /> {task.time}
            </span>
          )}
          <TaskPersonPicker
            personId={task.requesterPersonId}
            personName={task.requesterPersonName}
            onChange={(next) => onAssignPerson(task.id, next)}
          />
          {task.tags && task.tags.length > 0 && (
            <NoteTagList
              tags={task.tags}
              limit={4}
              onPersonClick={onPersonTagClick}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onShowEvidence(task)}
        title="Show evidence"
        aria-label="Show evidence"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-white/0 group-hover:text-white/40 hover:bg-white/10 hover:text-indigo-300 transition-all"
      >
        <FileSearch size={16} />
      </button>

      <button className="w-8 h-8 flex items-center justify-center rounded-lg text-white/0 group-hover:text-white/40 hover:bg-white/10 transition-all">
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

export function Tasks() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const userName = firstName(user?.name);
  const { tasks, addTask, updateTask, toggleTask } = useRecallData();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [quickAdd, setQuickAdd] = useState("");
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [personFilterId, setPersonFilterId] = useState<string | null>(null);
  const [personFilterName, setPersonFilterName] = useState<string | null>(null);
  const [evidenceTask, setEvidenceTask] = useState<Task | null>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const taskRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const aiChat = useAiChat();
  const { data: aiStatus } = useGetAiStatus();

  useEffect(() => {
    const id = readSearchParam("person");
    setPersonFilterId(id);
    if (!id) {
      setPersonFilterName(null);
      return;
    }
    const fromTask = tasks.find((t) => t.requesterPersonId === id)?.requesterPersonName;
    if (fromTask) {
      setPersonFilterName(fromTask);
      return;
    }
    void listPeople()
      .then((res) => {
        const hit = res.people.find((p) => p.id === id);
        setPersonFilterName(hit?.displayName ?? null);
      })
      .catch(() => setPersonFilterName(null));
  }, [location, tasks]);

  useEffect(() => {
    const taskId = readSearchParam("task");
    if (!taskId || !tasks.some((t) => t.id === taskId)) return;

    setHighlightedTaskId(taskId);
    requestAnimationFrame(() => {
      taskRefs.current[taskId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightedTaskId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [location, tasks]);

  const formatTime = () =>
    new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || aiChat.isPending) return;

    const userMsg: ChatMsg = { role: "user", content: trimmed, time: formatTime() };
    const history = [...messages, userMsg];
    setMessages(history);
    setDraft("");

    try {
      const res = await aiChat.mutateAsync({
        data: {
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context: {
            userName,
            tasks: tasksForAiContext(tasks),
            notes: [],
          },
        },
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message.content,
          time: formatTime(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong reaching Recall AI. Check that the API is running.",
          time: formatTime(),
        },
      ]);
    }
  };

  const handleAddTask = (title: string) => {
    addTask(title);
    setQuickAdd("");
  };

  const assignPerson = (
    taskId: string,
    next: { personId: string | null; personName: string | null },
  ) => {
    // Server syncs person: tags when requesterPersonId changes.
    updateTask(taskId, {
      requesterPersonId: next.personId,
      requesterPersonName: next.personName,
    });
  };

  const appendToDraft = (text: string) => {
    setDraft((prev) => (prev ? `${prev} ${text}` : text));
  };

  const matchesPerson = (t: Task) => {
    if (!personFilterId) return true;
    if (t.requesterPersonId === personFilterId) return true;
    // Also include tasks that only have a person: tag (no FK yet).
    if (!personFilterName) return false;
    const lower = personFilterName.toLowerCase();
    return (t.tags ?? []).some((tag) => {
      const name = parsePersonTag(tag);
      if (!name) return false;
      const n = name.toLowerCase();
      return n === lower || n.includes(lower) || lower.includes(n);
    });
  };
  const openTasks = tasks.filter((t) => !t.completed && matchesPerson(t));
  const completed = tasks.filter((t) => t.completed && matchesPerson(t));
  const clearPersonFilter = () => {
    setPersonFilterId(null);
    setPersonFilterName(null);
    navigate(tasksPath(), { replace: true });
  };

  return (
    <AppLayout>
      <div className="flex h-full w-full">
        
        {/* LEFT PANEL: Tasks */}
        <div className="flex-1 flex flex-col relative min-w-0 lg:min-w-[400px]">
          {/* Header */}
          <header className="pt-6 pb-4 px-4 md:pt-10 md:pb-6 md:px-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-white/[0.04]">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium border border-indigo-500/20">
                  {openTasks.length} remaining
                </span>
              </div>
              <p className="text-white/40 text-sm flex items-center gap-2">
                <Calendar size={14} /> {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>
            
            <button
              type="button"
              onClick={() => quickAddRef.current?.focus()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 font-medium text-sm transition-colors border border-white/5"
            >
              <Plus size={16} />
              Add task
            </button>
          </header>

          {personFilterId && (
            <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 md:mx-10">
              <p className="text-sm text-sky-100">
                Showing tasks linked to{" "}
                <span className="font-medium">{personFilterName ?? "this person"}</span>
              </p>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {personFilterName && (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        askPath({
                          q: `What do I know about ${personFilterName}? What am I waiting on from them?`,
                        }),
                      )
                    }
                    className="rounded-lg px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/20"
                  >
                    Ask
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(peoplePath({ personId: personFilterId }))}
                  className="rounded-lg px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/20"
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={clearPersonFilter}
                  className="rounded-lg px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/20"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="px-4 md:px-10 py-3 flex gap-4 md:gap-6 text-sm font-medium border-b border-white/[0.04] overflow-x-auto">
            <button className="text-white border-b-2 border-indigo-500 pb-3 -mb-[13px]">Today</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3">Upcoming</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3">All</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3 ml-auto flex items-center gap-1">
              Filter <Plus size={14} />
            </button>
          </div>

          {/* Task List */}
          <div className="flex-1 overflow-y-auto task-scroll px-4 md:px-8 pb-28 md:pb-32 pt-6">
            
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/30 mb-3 px-3">To do</h3>
              <div className="space-y-1">
                {openTasks.length === 0 && (
                  <p className="text-sm text-white/30 px-3 py-4">No tasks yet — use quick add below or Add task.</p>
                )}
                {openTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={toggleTask}
                    onShowEvidence={setEvidenceTask}
                    onAssignPerson={assignPerson}
                    onPersonTagClick={(name) => navigate(notesPath({ person: name }))}
                    highlighted={highlightedTaskId === task.id}
                    itemRef={(el) => {
                      taskRefs.current[task.id] = el;
                    }}
                  />
                ))}
              </div>
            </div>

            {completed.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/30 mb-3 px-3">Done</h3>
              <div className="space-y-1">
                {completed.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={toggleTask}
                    onShowEvidence={setEvidenceTask}
                    onAssignPerson={assignPerson}
                    onPersonTagClick={(name) => navigate(notesPath({ person: name }))}
                    highlighted={highlightedTaskId === task.id}
                    itemRef={(el) => {
                      taskRefs.current[task.id] = el;
                    }}
                  />
                ))}
              </div>
            </div>
            )}

          </div>

          {/* Quick Add */}
          <div className="absolute bottom-6 left-10 right-28">
            <div className="relative group">
              <input
                ref={quickAddRef}
                type="text"
                placeholder="Quick add a task..."
                value={quickAdd}
                onChange={(e) => setQuickAdd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTask(quickAdd);
                  }
                }}
                className="w-full bg-[#12121a]/80 backdrop-blur-md border border-white/10 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 shadow-2xl transition-all"
              />
              <Plus size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            </div>
          </div>

          <MicButton
            onTranscript={(text) => void sendMessage(text)}
            className="hidden md:flex absolute bottom-6 right-8 w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 items-center justify-center text-white animate-mic-pulse hover:scale-105 transition-transform z-10"
            iconSize={24}
            title="Talk to Recall AI"
          />
        </div>


        {/* RIGHT PANEL: AI Chat Assistant — desktop only */}
        <div className="hidden lg:flex w-[45%] max-w-[600px] border-l border-white/[0.06] bg-[#0c0c12]/80 backdrop-blur-3xl flex-col relative z-20 shadow-[-20px_0_40px_rgba(0,0,0,0.2)]">
          
          {/* Header */}
          <header className="px-6 py-5 flex items-center justify-between border-b border-white/[0.04]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center relative">
                <Sparkles size={16} className="text-white" />
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#0c0c12] rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-ai-pulse" />
                </div>
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-white/90">Recall AI</h2>
                <div className="text-[11px] text-white/40 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-green-400" /> Online
                </div>
              </div>
            </div>
            
            <div className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-medium text-white/60 tracking-wider">
              {aiStatus?.enabled ? (aiStatus.model ?? "GPT") : "Offline"}
            </div>
          </header>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto task-scroll p-6 space-y-6">
            {messages.length === 0 && (
              <p className="text-sm text-white/40 text-center py-8">
                Ask about your tasks, notes, or priorities. Recall sees your current task list.
              </p>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-[14px] max-w-[90%] whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-white/10 text-white/90 rounded-tr-sm"
                      : "bg-indigo-500/10 border-l-2 border-indigo-500 text-white/90 rounded-tl-sm shadow-[0_4px_20px_rgba(99,102,241,0.05)]"
                  }`}
                >
                  {msg.content}
                </div>
                <span className={`text-[10px] text-white/30 ${msg.role === "user" ? "mr-1" : "ml-1"}`}>
                  {msg.time}
                </span>
              </div>
            ))}
            {aiChat.isPending && (
              <div className="flex items-start gap-2 text-sm text-white/40 ml-1">
                <Sparkles size={14} className="animate-pulse text-indigo-400" />
                Recall is thinking…
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 bg-[#0a0a0f] border-t border-white/[0.04]">
            
            {/* Quick prompts */}
            <div className="flex gap-2 mb-3 overflow-x-auto task-scroll pb-1">
              {["Prioritize my tasks", "What did I miss?", "Summarize my notes"].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                  className="whitespace-nowrap px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] font-medium text-white/60 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Chat Box */}
            <div className="bg-[#15151e] border border-white/10 rounded-2xl p-2 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all flex flex-col">
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(draft);
                  }
                }}
                placeholder="Ask Recall anything..."
                className="w-full bg-transparent resize-none text-[14px] text-white placeholder:text-white/30 px-2 py-1.5 focus:outline-none"
              />
              <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1">
                  <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors">
                    <Paperclip size={16} />
                  </button>
                  <MicButton
                    onTranscript={appendToDraft}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
                    title="Voice input"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void sendMessage(draft)}
                  disabled={aiChat.isPending || !draft.trim()}
                  className="w-8 h-8 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 flex items-center justify-center text-white transition-colors shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                >
                  <Send size={14} className="ml-0.5" />
                </button>
              </div>
            </div>
            
            <div className="text-center mt-3">
              <p className="text-[10px] text-white/20">Recall AI can make mistakes. Verify important tasks.</p>
            </div>
          </div>
          
        </div>
      </div>
      <EvidenceDrawer
        open={evidenceTask != null}
        onClose={() => setEvidenceTask(null)}
        entityType="task"
        entityId={evidenceTask?.id ?? ""}
        title={evidenceTask?.title}
      />
    </AppLayout>
  );
}
