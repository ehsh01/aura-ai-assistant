import React, { useState } from "react";
import { AppLayout } from "./_shared/AppLayout";
import { Search, Mic, Bell, Clock, Calendar, CheckCircle2, Circle, MoreHorizontal, MessageSquare, Sparkles, Pin } from "lucide-react";
import "./_group.css";

export function Dashboard() {
  const [searchFocused, setSearchFocused] = useState(false);

  const pinnedNotes = [
    {
      id: 1,
      title: "Product Strategy Q3",
      content: "Focus on AI integration and lowering latency for first byte. Need to discuss the new architectural patterns with engineering team before Friday.",
      date: "2h ago",
      tags: ["Strategy", "Work"]
    },
    {
      id: 2,
      title: "Weekly Reflection",
      content: "Felt good about the progress this week. Managed to ship 3 major features. Still need to balance deep work with code reviews better.",
      date: "Yesterday",
      tags: ["Personal"]
    },
    {
      id: 3,
      title: "Design System v2",
      content: "Updated color palette and refined component tokens. The new spacing scale is ready for review by the design sync tomorrow.",
      date: "2d ago",
      tags: ["Design"]
    }
  ];

  const recentNotes = [
    { id: 4, title: "Meeting with Sarah", date: "4h ago" },
    { id: 5, title: "Books to read this year", date: "Yesterday" },
    { id: 6, title: "Idea: Voice commands", date: "3d ago" },
    { id: 7, title: "Grocery list", date: "1w ago" },
  ];

  const upcomingTasks = [
    { id: 1, title: "Review PR #452 (Dashboard Redesign)", priority: "high", completed: false },
    { id: 2, title: "Send update email to investors", priority: "medium", completed: false },
    { id: 3, title: "Draft blog post about new feature", priority: "low", completed: false },
    { id: 4, title: "Pay internet bill", priority: "medium", completed: false },
  ];

  const aiConversations = [
    "What were the key takeaways from yesterday's product sync?",
    "Draft a polite email declining the vendor offer.",
    "Summarize my notes on 'Product Strategy Q3'.",
    "Remind me what books I wanted to read.",
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-red-400";
      case "medium": return "bg-yellow-400";
      case "low": return "bg-zinc-500";
      default: return "bg-zinc-500";
    }
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <AppLayout activePage="dashboard">
      <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0f] text-zinc-100">
        
        {/* Top Header */}
        <header className="flex-none px-8 py-6 flex items-center justify-between z-10 dashboard-animate-fade-in-up">
          <div className="flex-1 max-w-2xl">
            <div className="relative dashboard-search-glow flex items-center bg-white/[0.03] border border-white/[0.08] rounded-2xl px-4 py-3">
              <Search className="w-5 h-5 text-indigo-400/70 mr-3" />
              <input 
                type="text" 
                placeholder="Ask Aura anything..." 
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-500 w-full font-medium"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
              <div className="flex items-center gap-1.5 ml-3">
                <kbd className="hidden sm:inline-flex text-[10px] font-medium text-zinc-500 bg-white/[0.05] border border-white/[0.1] rounded px-1.5 py-0.5">⌘</kbd>
                <kbd className="hidden sm:inline-flex text-[10px] font-medium text-zinc-500 bg-white/[0.05] border border-white/[0.1] rounded px-1.5 py-0.5">K</kbd>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 ml-8">
            <button className="relative w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors group dashboard-animate-pulse-ring cursor-pointer">
              <Mic className="w-5 h-5" />
            </button>

            <button className="relative w-10 h-10 rounded-full bg-white/[0.03] text-zinc-400 flex items-center justify-center border border-white/[0.08] hover:bg-white/[0.08] hover:text-zinc-200 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-indigo-500 rounded-full border-2 border-[#0a0a0f]"></span>
            </button>
            
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-sm font-bold shadow-[0_0_15px_rgba(99,102,241,0.3)] cursor-pointer">
              AM
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 pt-2 dashboard-hide-scrollbar">
          <div className="max-w-6xl mx-auto space-y-12">
            
            {/* Greeting */}
            <section className="dashboard-animate-fade-in-up dashboard-delay-100">
              <div className="flex items-baseline gap-3 mb-2">
                <h1 className="text-4xl font-semibold tracking-tight text-white">Good morning, Alex</h1>
              </div>
              <div className="flex items-center gap-2 text-zinc-400 text-sm mb-6">
                <Calendar className="w-4 h-4" />
                <span>{currentDate}</span>
              </div>
              
              <div className="inline-flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-2.5 text-sm text-indigo-200">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <p>You have <span className="font-semibold text-white">3 tasks due today</span> and <span className="font-semibold text-white">2 unread notes</span> from yesterday.</p>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Notes */}
              <div className="lg:col-span-8 space-y-10">
                
                {/* Pinned Notes */}
                <section className="dashboard-animate-fade-in-up dashboard-delay-200">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                      <Pin className="w-4 h-4 text-zinc-400" /> Pinned Notes
                    </h2>
                    <button className="text-sm text-zinc-400 hover:text-indigo-400 transition-colors">View all</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pinnedNotes.map((note) => (
                      <div key={note.id} className="dashboard-glass-card rounded-2xl p-5 cursor-pointer flex flex-col h-48">
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-medium text-zinc-100 truncate pr-4">{note.title}</h3>
                          <button className="text-zinc-500 hover:text-zinc-300">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-sm text-zinc-400 line-clamp-3 leading-relaxed mb-auto">
                          {note.content}
                        </p>
                        <div className="flex items-center justify-between mt-4">
                          <span className="text-xs text-zinc-500 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" /> {note.date}
                          </span>
                          <div className="flex gap-1.5">
                            {note.tags.map(tag => (
                              <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.05] text-zinc-300">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Add New Note Card */}
                    <div className="dashboard-glass-card rounded-2xl p-5 cursor-pointer flex flex-col items-center justify-center h-48 border-dashed border-white/[0.1] hover:border-indigo-500/30 group">
                      <div className="w-10 h-10 rounded-full bg-white/[0.03] group-hover:bg-indigo-500/10 flex items-center justify-center mb-3 transition-colors">
                        <span className="text-2xl text-zinc-400 group-hover:text-indigo-400 font-light">+</span>
                      </div>
                      <span className="text-sm text-zinc-400 group-hover:text-indigo-300 font-medium">Create New Note</span>
                    </div>
                  </div>
                </section>

                {/* Recent Notes Strip */}
                <section className="dashboard-animate-fade-in-up dashboard-delay-300">
                  <h2 className="text-lg font-medium text-zinc-100 mb-5">Recent Activity</h2>
                  <div className="flex gap-3 overflow-x-auto dashboard-hide-scrollbar pb-2">
                    {recentNotes.map((note) => (
                      <div key={note.id} className="flex-none w-48 dashboard-glass-card rounded-xl p-3.5 cursor-pointer group">
                        <div className="flex flex-col h-full">
                          <h3 className="font-medium text-sm text-zinc-200 truncate mb-2 group-hover:text-indigo-300 transition-colors">{note.title}</h3>
                          <span className="text-xs text-zinc-500 mt-auto">{note.date}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                
              </div>

              {/* Right Column: Tasks */}
              <div className="lg:col-span-4 space-y-10">
                <section className="dashboard-animate-fade-in-up dashboard-delay-400 bg-white/[0.02] border border-white/[0.05] rounded-3xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                  
                  <div className="flex items-center justify-between mb-6 relative z-10">
                    <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-indigo-400" /> Upcoming Tasks
                    </h2>
                  </div>
                  
                  <div className="space-y-3 relative z-10">
                    {upcomingTasks.map((task) => (
                      <div key={task.id} className="group flex items-start gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors cursor-pointer border border-transparent hover:border-white/[0.05]">
                        <button className="mt-0.5 text-zinc-500 hover:text-indigo-400 transition-colors flex-shrink-0">
                          <Circle className="w-4 h-4" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate group-hover:text-white transition-colors">{task.title}</p>
                        </div>
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getPriorityColor(task.priority)}`} />
                      </div>
                    ))}
                  </div>
                  
                  <button className="w-full mt-6 py-2.5 rounded-xl text-sm font-medium text-zinc-400 bg-white/[0.03] hover:bg-white/[0.06] hover:text-zinc-200 transition-all border border-white/[0.05]">
                    View all tasks
                  </button>
                </section>
              </div>
            </div>

            {/* Bottom: Recent AI Conversations */}
            <section className="dashboard-animate-fade-in-up dashboard-delay-500 pt-6">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Recent AI Conversations
              </h2>
              <div className="flex flex-wrap gap-3">
                {aiConversations.map((conv, idx) => (
                  <div key={idx} className="dashboard-glass-card rounded-full px-4 py-2 text-sm text-zinc-300 cursor-pointer flex items-center gap-2 hover:bg-indigo-500/10 hover:text-indigo-200 hover:border-indigo-500/20 transition-all">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500/50"></span>
                    <span className="truncate max-w-xs">{conv}</span>
                  </div>
                ))}
              </div>
            </section>
            
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
