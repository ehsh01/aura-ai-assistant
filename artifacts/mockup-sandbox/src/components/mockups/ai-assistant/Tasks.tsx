import React, { useState } from "react";
import { AppLayout } from "./_shared/AppLayout";
import { 
  Check, 
  Circle, 
  GripVertical, 
  Mic, 
  Paperclip, 
  Plus, 
  Send, 
  Sparkles, 
  Tag, 
  MoreHorizontal,
  Calendar,
  Clock
} from "lucide-react";
import "./tasks-group.css";

// --- Types & Mock Data ---
type Priority = "high" | "med" | "low" | "none";

interface Task {
  id: string;
  title: string;
  time?: string;
  priority: Priority;
  tags?: string[];
  completed: boolean;
}

const MORNING_TASKS: Task[] = [
  { id: "1", title: "Review Q3 metrics", time: "9:00 AM", priority: "high", tags: ["Work"], completed: false },
  { id: "2", title: "Finish project proposal", time: "10:30 AM", priority: "high", tags: ["Deep Work"], completed: false },
  { id: "3", title: "Sync with design team", time: "11:30 AM", priority: "med", completed: false },
];

const AFTERNOON_TASKS: Task[] = [
  { id: "4", title: "Call Dr. Martinez", time: "2:00 PM", priority: "high", tags: ["Personal"], completed: false },
  { id: "5", title: "Review pull request #442", priority: "med", tags: ["Dev"], completed: false },
  { id: "6", title: "Grocery run", time: "5:00 PM", priority: "low", completed: false },
];

const COMPLETED_TASKS: Task[] = [
  { id: "7", title: "Morning workout", time: "7:00 AM", priority: "low", completed: true },
  { id: "8", title: "Inbox zero", time: "8:30 AM", priority: "med", completed: true },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  high: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]",
  med: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]",
  low: "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]",
  none: "bg-white/20"
};

// --- Components ---

function TaskItem({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  return (
    <div className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-white/5 hover:bg-white/[0.02] transition-colors ${task.completed ? "opacity-50" : ""}`}>
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
        {(task.time || task.tags) && (
          <div className="flex items-center gap-3 mt-1 text-[12px] text-white/40">
            {task.time && (
              <span className="flex items-center gap-1">
                <Clock size={12} /> {task.time}
              </span>
            )}
            {task.tags && task.tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-md">
                <Tag size={10} /> {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <button className="w-8 h-8 flex items-center justify-center rounded-lg text-white/0 group-hover:text-white/40 hover:bg-white/10 transition-all">
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

export function Tasks() {
  const [tasks, setTasks] = useState([...MORNING_TASKS, ...AFTERNOON_TASKS, ...COMPLETED_TASKS]);

  const toggleTask = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const morning = tasks.filter(t => !t.completed && MORNING_TASKS.some(m => m.id === t.id));
  const afternoon = tasks.filter(t => !t.completed && AFTERNOON_TASKS.some(a => a.id === t.id));
  const completed = tasks.filter(t => t.completed);

  return (
    <AppLayout activePage="tasks">
      <div className="flex h-full w-full">
        
        {/* LEFT PANEL: Tasks */}
        <div className="flex-1 flex flex-col relative min-w-[400px]">
          {/* Header */}
          <header className="pt-10 pb-6 px-10 flex items-end justify-between border-b border-white/[0.04]">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium border border-indigo-500/20">
                  {tasks.filter(t => !t.completed).length} remaining
                </span>
              </div>
              <p className="text-white/40 text-sm flex items-center gap-2">
                <Calendar size={14} /> Thursday, October 24
              </p>
            </div>
            
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 font-medium text-sm transition-colors border border-white/5">
              <Plus size={16} />
              Add task
            </button>
          </header>

          {/* Filters */}
          <div className="px-10 py-3 flex gap-6 text-sm font-medium border-b border-white/[0.04]">
            <button className="text-white border-b-2 border-indigo-500 pb-3 -mb-[13px]">Today</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3">Upcoming</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3">All</button>
            <button className="text-white/40 hover:text-white/70 transition-colors pb-3 ml-auto flex items-center gap-1">
              Filter <Plus size={14} />
            </button>
          </div>

          {/* Task List */}
          <div className="flex-1 overflow-y-auto task-scroll px-8 pb-32 pt-6">
            
            {/* Section: Morning */}
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/30 mb-3 px-3">Morning</h3>
              <div className="space-y-1">
                {morning.map(task => (
                  <TaskItem key={task.id} task={task} onToggle={toggleTask} />
                ))}
              </div>
            </div>

            {/* Section: Afternoon */}
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/30 mb-3 px-3">Afternoon</h3>
              <div className="space-y-1">
                {afternoon.map(task => (
                  <TaskItem key={task.id} task={task} onToggle={toggleTask} />
                ))}
              </div>
            </div>

            {/* Section: Completed */}
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/30 mb-3 px-3">Completed</h3>
              <div className="space-y-1">
                {completed.map(task => (
                  <TaskItem key={task.id} task={task} onToggle={toggleTask} />
                ))}
              </div>
            </div>

          </div>

          {/* Quick Add */}
          <div className="absolute bottom-6 left-10 right-28">
            <div className="relative group">
              <input 
                type="text" 
                placeholder="Quick add a task..." 
                className="w-full bg-[#12121a]/80 backdrop-blur-md border border-white/10 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 shadow-2xl transition-all"
              />
              <Plus size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
            </div>
          </div>

          {/* Floating Mic FAB */}
          <button className="absolute bottom-6 right-8 w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white animate-mic-pulse hover:scale-105 transition-transform z-10">
            <Mic size={24} />
          </button>
        </div>


        {/* RIGHT PANEL: AI Chat Assistant */}
        <div className="w-[45%] max-w-[600px] border-l border-white/[0.06] bg-[#0c0c12]/80 backdrop-blur-3xl flex flex-col relative z-20 shadow-[-20px_0_40px_rgba(0,0,0,0.2)]">
          
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
                <h2 className="text-[15px] font-semibold tracking-tight text-white/90">Aura AI</h2>
                <div className="text-[11px] text-white/40 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-green-400" /> Online
                </div>
              </div>
            </div>
            
            <div className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-medium text-white/60 tracking-wider">
              GPT-4o
            </div>
          </header>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto task-scroll p-6 space-y-6">
            
            {/* Msg 1 */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="bg-white/10 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[14px] text-white/90 max-w-[85%]">
                What do I have left for today?
              </div>
              <span className="text-[10px] text-white/30 mr-1">1:42 PM</span>
            </div>

            {/* Msg 2 */}
            <div className="flex flex-col items-start gap-1.5">
              <div className="bg-indigo-500/10 border-l-2 border-indigo-500 px-4 py-3 rounded-2xl rounded-tl-sm text-[14px] text-white/90 max-w-[90%] shadow-[0_4px_20px_rgba(99,102,241,0.05)]">
                <p className="mb-3">You have <strong className="text-white">4 tasks</strong> remaining for today:</p>
                <ul className="space-y-2 text-white/70">
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <span><strong>Review Q3 metrics</strong> (High priority, missed 9:00 AM)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <span><strong>Call Dr. Martinez</strong> at 2:00 PM</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-1.5 shrink-0" />
                    <span><strong>Review pull request #442</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                    <span><strong>Grocery run</strong> at 5:00 PM</span>
                  </li>
                </ul>
              </div>
              <span className="text-[10px] text-white/30 ml-1">1:42 PM</span>
            </div>

            {/* Msg 3 */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="bg-white/10 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[14px] text-white/90 max-w-[85%]">
                Move the grocery run to tomorrow
              </div>
            </div>

            {/* Msg 4 */}
            <div className="flex flex-col items-start gap-1.5">
              <div className="bg-indigo-500/10 border-l-2 border-indigo-500 px-4 py-3 rounded-2xl rounded-tl-sm text-[14px] text-white/90 max-w-[90%] shadow-[0_4px_20px_rgba(99,102,241,0.05)]">
                Done! I've moved <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs mx-1">Grocery run</span> to tomorrow. Anything else?
              </div>
            </div>

            {/* Msg 5 */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="bg-white/10 px-4 py-2.5 rounded-2xl rounded-tr-sm text-[14px] text-white/90 max-w-[85%]">
                Summarize my notes from the team meeting yesterday
              </div>
            </div>

            {/* Msg 6 */}
            <div className="flex flex-col items-start gap-1.5">
              <div className="bg-indigo-500/10 border-l-2 border-indigo-500 px-4 py-3 rounded-2xl rounded-tl-sm text-[14px] text-white/90 max-w-[90%] shadow-[0_4px_20px_rgba(99,102,241,0.05)]">
                <p className="mb-2 text-indigo-200">Here's a quick summary of the Design Sync (Oct 23):</p>
                <ul className="space-y-1.5 text-white/80 list-disc pl-4 marker:text-indigo-500/50">
                  <li><strong>Q4 Vision:</strong> Shift focus to mobile-first interactions.</li>
                  <li><strong>New Component Library:</strong> Needs review by Friday. You were assigned the button variants.</li>
                  <li><strong>Blocker:</strong> Waiting on marketing copy for the landing page hero section.</li>
                </ul>
              </div>
            </div>

          </div>

          {/* Input Area */}
          <div className="p-4 bg-[#0a0a0f] border-t border-white/[0.04]">
            
            {/* Quick prompts */}
            <div className="flex gap-2 mb-3 overflow-x-auto task-scroll pb-1">
              <button className="whitespace-nowrap px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] font-medium text-white/60 transition-colors">
                Prioritize my tasks
              </button>
              <button className="whitespace-nowrap px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] font-medium text-white/60 transition-colors">
                What did I miss?
              </button>
              <button className="whitespace-nowrap px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] font-medium text-white/60 transition-colors">
                Add a task
              </button>
            </div>

            {/* Chat Box */}
            <div className="bg-[#15151e] border border-white/10 rounded-2xl p-2 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all flex flex-col">
              <textarea 
                rows={1}
                placeholder="Ask Aura anything..." 
                className="w-full bg-transparent resize-none text-[14px] text-white placeholder:text-white/30 px-2 py-1.5 focus:outline-none"
              />
              <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/5">
                <div className="flex items-center gap-1">
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors">
                    <Paperclip size={16} />
                  </button>
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors">
                    <Mic size={16} />
                  </button>
                </div>
                <button className="w-8 h-8 rounded-lg bg-indigo-500 hover:bg-indigo-400 flex items-center justify-center text-white transition-colors shadow-[0_0_10px_rgba(99,102,241,0.3)]">
                  <Send size={14} className="ml-0.5" />
                </button>
              </div>
            </div>
            
            <div className="text-center mt-3">
              <p className="text-[10px] text-white/20">Aura AI can make mistakes. Verify important tasks.</p>
            </div>
          </div>
          
        </div>
      </div>
    </AppLayout>
  );
}
