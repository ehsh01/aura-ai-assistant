import React, { useState } from "react";
import { AppLayout } from "./_shared/AppLayout";
import { Search, Mic, Bell, Clock, Calendar, CheckCircle2, Circle, MoreHorizontal, MessageSquare, Sparkles, Pin } from "lucide-react";
import "./chrome-group.css";

export function DashboardChrome() {
  const [searchFocused, setSearchFocused] = useState(false);

  const pinnedNotes = [
    {
      id: 1,
      title: "Product Strategy Q3",
      content: "Focus on AI integration and lowering latency for first byte. Need to discuss the new architectural patterns with engineering team before Friday.",
      date: "2h ago",
      tags: ["Strategy", "Work"],
      tint: "rgba(6, 182, 212, 0.03)" // teal
    },
    {
      id: 2,
      title: "Weekly Reflection",
      content: "Felt good about the progress this week. Managed to ship 3 major features. Still need to balance deep work with code reviews better.",
      date: "Yesterday",
      tags: ["Personal"],
      tint: "rgba(168, 85, 247, 0.03)" // violet
    }
  ];

  const recentNotes = [
    { id: 4, title: "Meeting with Sarah", date: "4h ago", tint: "rgba(6, 182, 212, 0.05)" },
    { id: 5, title: "Books to read this year", date: "Yesterday", tint: "rgba(168, 85, 247, 0.05)" },
    { id: 6, title: "Idea: Voice commands", date: "3d ago", tint: "rgba(234, 179, 8, 0.05)" },
    { id: 7, title: "Grocery list", date: "1w ago", tint: "rgba(236, 72, 153, 0.05)" },
  ];

  const upcomingTasks = [
    { id: 1, title: "Review PR #452 (Dashboard Redesign)", priority: "high", completed: false },
    { id: 2, title: "Send update email to investors", priority: "medium", completed: false },
    { id: 3, title: "Draft blog post about new feature", priority: "low", completed: false },
  ];

  const aiConversations = [
    "What were the key takeaways from yesterday's product sync?",
    "Draft a polite email declining the vendor offer.",
    "Summarize my notes on 'Product Strategy Q3'.",
  ];

  return (
    <AppLayout activePage="dashboard">
      <div className="flex flex-col h-full overflow-hidden chrome-bg text-zinc-100">
        <div className="chrome-radial" />
        
        {/* Top Header */}
        <header className="flex-none px-8 py-6 flex items-center justify-between z-10">
          <div className="flex-1 max-w-2xl">
            <div className={`relative chrome-glass rounded-full px-5 py-3.5 flex items-center transition-all duration-300 ${searchFocused ? 'chrome-shimmer-border active' : ''}`}>
              <Search className="w-5 h-5 text-indigo-300 mr-3" />
              <div className="flex-1 flex items-center">
                <input 
                  type="text" 
                  placeholder="Ask Aura anything..." 
                  className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-500 w-full font-medium"
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                />
                {!searchFocused && <span className="chrome-cursor" />}
              </div>
              <div className="flex items-center gap-1.5 ml-3">
                <kbd className="hidden sm:inline-flex text-[10px] font-medium text-zinc-400 bg-white/[0.05] border border-white/[0.1] rounded px-1.5 py-0.5">⌘</kbd>
                <kbd className="hidden sm:inline-flex text-[10px] font-medium text-zinc-400 bg-white/[0.05] border border-white/[0.1] rounded px-1.5 py-0.5">K</kbd>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 ml-8">
            <button className="relative w-12 h-12 rounded-full chrome-glass text-indigo-300 flex items-center justify-center transition-colors group chrome-floating cursor-pointer">
              <div className="chrome-mic-ring" />
              <Mic className="w-5 h-5" />
            </button>

            <button className="relative w-10 h-10 rounded-full chrome-glass text-zinc-400 flex items-center justify-center transition-colors chrome-floating">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-indigo-400 rounded-full shadow-[0_0_8px_rgba(129,140,248,0.8)]"></span>
            </button>
            
            <div className="w-10 h-10 rounded-full chrome-glass flex items-center justify-center text-sm font-bold chrome-text-gradient cursor-pointer chrome-floating">
              AM
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 pt-2 chrome-hide-scrollbar z-10">
          <div className="max-w-6xl mx-auto space-y-12">
            
            {/* Greeting */}
            <section className="dashboard-animate-fade-in-up">
              <div className="flex items-baseline gap-3 mb-2">
                <h1 className="text-5xl font-bold tracking-tight chrome-text-gradient py-1">Good morning, Alex</h1>
              </div>
              <div className="flex items-center gap-2 text-zinc-400 text-sm mb-8">
                <Calendar className="w-4 h-4" />
                <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              </div>
              
              <div className="inline-flex items-center gap-3 chrome-glass rounded-2xl px-5 py-3 text-sm text-indigo-200">
                <Sparkles className="w-4 h-4 text-indigo-300" />
                <p>You have <span className="font-semibold text-white">3 tasks due today</span> and <span className="font-semibold text-white">2 unread notes</span> from yesterday.</p>
              </div>
            </section>

            {/* Stats Row */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6 dashboard-animate-fade-in-up">
              <div className="chrome-glass chrome-floating rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-80" />
                <p className="text-zinc-400 text-sm font-medium mb-2">Total Notes</p>
                <p className="text-4xl font-bold chrome-text-gradient">128</p>
              </div>
              <div className="chrome-glass chrome-floating rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-violet-400 to-fuchsia-500 opacity-80" />
                <p className="text-zinc-400 text-sm font-medium mb-2">Tasks Completed</p>
                <p className="text-4xl font-bold chrome-text-gradient">34</p>
              </div>
              <div className="chrome-glass chrome-floating rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 to-orange-500 opacity-80" />
                <p className="text-zinc-400 text-sm font-medium mb-2">AI Interactions</p>
                <p className="text-4xl font-bold chrome-text-gradient">89</p>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Notes */}
              <div className="lg:col-span-8 space-y-10">
                
                {/* Pinned Notes */}
                <section className="dashboard-animate-fade-in-up">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                      <Pin className="w-4 h-4 text-zinc-400" /> Pinned Notes
                    </h2>
                    <button className="text-sm text-zinc-400 hover:text-indigo-300 transition-colors">View all</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pinnedNotes.map((note) => (
                      <div key={note.id} className="chrome-glass chrome-light-leak rounded-3xl p-6 cursor-pointer flex flex-col h-52 chrome-floating" style={{ backgroundColor: note.tint }}>
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-medium text-zinc-100 truncate pr-4 text-lg">{note.title}</h3>
                          <button className="text-zinc-500 hover:text-zinc-300">
                            <MoreHorizontal className="w-5 h-5" />
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
                              <span key={tag} className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-white/[0.08] text-zinc-300">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Recent Notes Strip */}
                <section className="dashboard-animate-fade-in-up">
                  <h2 className="text-lg font-medium text-zinc-100 mb-5">Recent Activity</h2>
                  <div className="flex gap-4 overflow-x-auto chrome-hide-scrollbar chrome-snap-x pb-4">
                    {recentNotes.map((note) => (
                      <div key={note.id} className="flex-none w-56 chrome-glass rounded-2xl p-5 cursor-pointer chrome-floating chrome-snap-start" style={{ backgroundColor: note.tint }}>
                        <div className="flex flex-col h-full">
                          <h3 className="font-medium text-zinc-100 truncate mb-2">{note.title}</h3>
                          <span className="text-xs text-zinc-500 mt-auto">{note.date}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                
              </div>

              {/* Right Column: Tasks */}
              <div className="lg:col-span-4 space-y-10">
                <section className="chrome-glass chrome-shimmer-border rounded-3xl p-6 relative overflow-hidden h-full min-h-[400px]">
                  
                  <div className="flex items-center justify-between mb-6 relative z-10">
                    <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-indigo-300" /> Today's Tasks
                    </h2>
                  </div>
                  
                  <div className="space-y-4 relative z-10">
                    {upcomingTasks.map((task) => (
                      <div key={task.id} className="group flex items-start gap-3 p-3.5 rounded-2xl hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-white/[0.1]">
                        <button className="mt-0.5 text-zinc-500 hover:text-indigo-400 transition-colors flex-shrink-0">
                          <Circle className="w-4 h-4" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{task.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <button className="absolute bottom-6 left-6 right-6 py-3 rounded-2xl text-sm font-medium text-zinc-300 chrome-glass chrome-floating hover:text-white transition-all text-center">
                    View all tasks
                  </button>
                </section>
              </div>
            </div>

            {/* Bottom: Recent AI Conversations */}
            <section className="dashboard-animate-fade-in-up pb-8">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Ask Aura
              </h2>
              <div className="flex flex-wrap gap-3">
                {aiConversations.map((conv, idx) => (
                  <div key={idx} className="chrome-glass rounded-full px-5 py-2.5 text-sm text-zinc-300 cursor-pointer flex items-center gap-2 chrome-floating hover:text-white transition-all">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]"></span>
                    <span className="truncate max-w-sm">{conv}</span>
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
