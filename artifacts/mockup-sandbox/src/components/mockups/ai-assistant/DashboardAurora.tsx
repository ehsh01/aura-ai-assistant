import React, { useState } from "react";
import { AppLayout } from "./_shared/AppLayout";
import { Search, Mic, Bell, Clock, Calendar, CheckCircle2, Circle, MoreHorizontal, MessageSquare, Sparkles, Pin, Plus } from "lucide-react";
import "./aurora-group.css";

export function DashboardAurora() {
  const [searchFocused, setSearchFocused] = useState(false);

  const pinnedNotes = [
    {
      id: 1,
      title: "Product Strategy Q3",
      content: "Focus on AI integration and lowering latency for first byte. Need to discuss the new architectural patterns with engineering team before Friday.",
      date: "2h ago",
      tags: ["Strategy", "Work"],
      colorClass: "border-glow-emerald"
    },
    {
      id: 2,
      title: "Weekly Reflection",
      content: "Felt good about the progress this week. Managed to ship 3 major features. Still need to balance deep work with code reviews better.",
      date: "Yesterday",
      tags: ["Personal"],
      colorClass: "border-glow-violet"
    }
  ];

  const recentNotes = [
    { id: 4, title: "Meeting with Sarah", date: "4h ago", border: "border-glow-teal" },
    { id: 5, title: "Books to read", date: "Yesterday", border: "border-glow-indigo" },
    { id: 6, title: "Voice commands", date: "3d ago", border: "border-glow-emerald" },
    { id: 7, title: "Grocery list", date: "1w ago", border: "border-glow-violet" },
  ];

  const upcomingTasks = [
    { id: 1, title: "Review PR #452 (Dashboard Redesign)", priority: "high", time: "10:00 AM" },
    { id: 2, title: "Send update email to investors", priority: "medium", time: "1:30 PM" },
    { id: 3, title: "Draft blog post about new feature", priority: "low", time: "3:00 PM" },
  ];

  const aiConversations = [
    "What were the key takeaways from yesterday's product sync?",
    "Draft a polite email declining the vendor offer.",
    "Summarize my notes on 'Product Strategy Q3'."
  ];

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <AppLayout activePage="dashboard">
      <div className="relative flex flex-col h-full overflow-hidden bg-[#050508] text-zinc-100">
        
        {/* Animated Aurora Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="aurora-bg-base aurora-1"></div>
          <div className="aurora-bg-base aurora-2"></div>
          <div className="aurora-bg-base aurora-3"></div>
          <div className="aurora-bg-base aurora-4"></div>
        </div>

        {/* Content Wrapper */}
        <div className="relative z-10 flex flex-col h-full overflow-hidden">
          {/* Top Header */}
          <header className="flex-none px-8 py-6 flex items-center justify-between">
            <div className="flex-1 max-w-2xl">
              <div className="search-pill rounded-full px-5 py-3 flex items-center">
                <Search className={`w-5 h-5 mr-3 transition-colors ${searchFocused ? 'text-teal-400' : 'text-zinc-400'}`} />
                <input 
                  type="text" 
                  placeholder="Search or ask Aura..." 
                  className="bg-transparent border-none outline-none text-sm text-zinc-100 placeholder:text-zinc-500 w-full font-medium"
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                />
                <div className="flex items-center gap-1.5 ml-3">
                  <kbd className="hidden sm:inline-flex text-[10px] font-medium text-zinc-400 glass-pill-badge rounded px-2 py-0.5">⌘ K</kbd>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 ml-8">
              <button className="protruding-btn w-12 h-12 rounded-full flex items-center justify-center text-zinc-200">
                <Mic className="w-5 h-5 relative z-10" />
                <div className="ring-pulse-anim"></div>
              </button>

              <button className="depth-mid w-11 h-11 rounded-full flex items-center justify-center text-zinc-300 relative hover:text-white transition-colors">
                <Bell className="w-5 h-5" />
                <span className="absolute top-3 right-3 w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
              </button>
              
              <div className="depth-near w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold aurora-text-gradient cursor-pointer border border-white/20">
                AM
              </div>
            </div>
          </header>

          {/* Scrollable Main Area */}
          <div className="flex-1 overflow-y-auto px-8 pb-24 pt-4 hide-scrollbar">
            <div className="max-w-6xl mx-auto space-y-10">
              
              {/* Hero Section */}
              <section className="flex flex-col items-start">
                <h1 className="text-5xl font-bold tracking-tight mb-2 aurora-text-gradient py-1">Good morning, Alex</h1>
                <div className="flex items-center gap-3 text-zinc-400 text-sm mb-6 glass-pill-badge px-4 py-1.5 rounded-full">
                  <Calendar className="w-4 h-4 text-violet-400" />
                  <span>{currentDate}</span>
                </div>
                
                <div className="depth-far rounded-2xl px-5 py-3 text-sm text-zinc-300 flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-teal-400" />
                  <p>You're on a <span className="aurora-text-gradient font-bold">5-day streak</span> ✦ <span className="font-semibold text-white">3 tasks</span> need attention today.</p>
                </div>
              </section>

              {/* Stats Row */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="depth-near rounded-3xl p-6 relative overflow-hidden group">
                  <div className="absolute -bottom-8 -right-8 w-32 h-32 stat-orb-green blur-[40px] rounded-full group-hover:scale-110 transition-transform duration-700"></div>
                  <div className="relative z-10 flex flex-col h-full">
                    <span className="text-zinc-400 text-sm font-medium mb-1">Tasks</span>
                    <span className="text-4xl font-bold text-white mb-4">12</span>
                    <div className="glass-pill-badge w-fit px-3 py-1 rounded-full text-xs text-emerald-300 border-emerald-500/20">
                      4 due today
                    </div>
                  </div>
                </div>

                <div className="depth-near rounded-3xl p-6 relative overflow-hidden group">
                  <div className="absolute -bottom-8 -right-8 w-32 h-32 stat-orb-blue blur-[40px] rounded-full group-hover:scale-110 transition-transform duration-700"></div>
                  <div className="relative z-10 flex flex-col h-full">
                    <span className="text-zinc-400 text-sm font-medium mb-1">Notes</span>
                    <span className="text-4xl font-bold text-white mb-4">48</span>
                    <div className="glass-pill-badge w-fit px-3 py-1 rounded-full text-xs text-cyan-300 border-cyan-500/20">
                      +2 this week
                    </div>
                  </div>
                </div>

                <div className="depth-near rounded-3xl p-6 relative overflow-hidden group">
                  <div className="absolute -bottom-8 -right-8 w-32 h-32 stat-orb-violet blur-[40px] rounded-full group-hover:scale-110 transition-transform duration-700"></div>
                  <div className="relative z-10 flex flex-col h-full">
                    <span className="text-zinc-400 text-sm font-medium mb-1">Meetings</span>
                    <span className="text-4xl font-bold text-white mb-4">3</span>
                    <div className="glass-pill-badge w-fit px-3 py-1 rounded-full text-xs text-violet-300 border-violet-500/20">
                      Next in 2h
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column */}
                <div className="lg:col-span-8 space-y-10">
                  
                  {/* Pinned Notes */}
                  <section>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                        <Pin className="w-4 h-4 text-violet-400" /> Pinned Notes
                      </h2>
                      <button className="text-sm text-zinc-400 hover:text-white transition-colors glass-pill-badge px-3 py-1 rounded-full">View all</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3">
                      {pinnedNotes.map((note) => (
                        <div key={note.id} className={`depth-mid rounded-3xl p-6 cursor-pointer flex flex-col h-56 relative ${note.colorClass}`}>
                          {/* Floating Badges */}
                          <div className="absolute -top-3 right-6 flex gap-2 floating-badge">
                            {note.tags.map(tag => (
                              <span key={tag} className="text-[10px] font-medium px-3 py-1 rounded-full glass-pill-badge text-zinc-200">
                                {tag}
                              </span>
                            ))}
                          </div>
                          
                          <div className="flex justify-between items-start mb-4 mt-2">
                            <h3 className="font-semibold text-lg text-zinc-100 truncate pr-4">{note.title}</h3>
                          </div>
                          <p className="text-sm text-zinc-400 line-clamp-3 leading-relaxed mb-auto">
                            {note.content}
                          </p>
                          <div className="flex items-center justify-between mt-4">
                            <span className="text-xs text-zinc-500 flex items-center gap-1.5 glass-pill-badge px-2 py-1 rounded-full">
                              <Clock className="w-3.5 h-3.5" /> {note.date}
                            </span>
                            <button className="w-8 h-8 rounded-full glass-pill-badge flex items-center justify-center text-zinc-400 hover:text-white">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Recent Notes Strip */}
                  <section>
                    <h2 className="text-lg font-medium text-zinc-100 mb-5">Recent Activity</h2>
                    <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-4 pt-2">
                      {recentNotes.map((note) => (
                        <div key={note.id} className={`flex-none w-52 depth-far rounded-2xl p-4 cursor-pointer group ${note.border}`}>
                          <div className="flex flex-col h-full">
                            <h3 className="font-medium text-sm text-zinc-200 mb-2 group-hover:text-white transition-colors">{note.title}</h3>
                            <span className="text-xs text-zinc-500 mt-auto glass-pill-badge w-fit px-2 py-1 rounded-full">{note.date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  
                </div>

                {/* Right Column */}
                <div className="lg:col-span-4 space-y-10">
                  {/* Today's Tasks */}
                  <section className="depth-mid rounded-3xl p-6 relative overflow-hidden flex flex-col h-[400px]">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Today's Tasks
                      </h2>
                      <button className="protruding-btn w-8 h-8 rounded-full flex items-center justify-center text-white" style={{animation: 'none', transform: 'scale(0.8)'}}>
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                      {upcomingTasks.map((task) => (
                        <div key={task.id} className="depth-far rounded-xl p-4 flex gap-3 group border border-transparent hover:border-white/10 transition-all">
                          <button className="mt-0.5 text-zinc-500 hover:text-emerald-400 transition-colors flex-shrink-0">
                            <Circle className="w-5 h-5" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-200 mb-1">{task.title}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-zinc-500">{task.time}</span>
                              <div className={`w-2 h-2 rounded-full ${
                                task.priority === 'high' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]' : 
                                task.priority === 'medium' ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]' : 'bg-zinc-400'
                              }`} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              {/* Recent Aura Chats */}
              <section className="pt-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-5 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-indigo-400" /> Recent Aura Chats
                </h2>
                <div className="flex flex-wrap gap-4">
                  {aiConversations.map((conv, idx) => (
                    <div key={idx} className="depth-far aurora-gradient-border rounded-full px-5 py-2.5 text-sm text-zinc-200 cursor-pointer flex items-center gap-2 hover:bg-white/5 transition-all group">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 group-hover:shadow-[0_0_8px_rgba(129,140,248,0.8)] transition-all"></span>
                      <span>{conv}</span>
                    </div>
                  ))}
                </div>
              </section>
              
            </div>
          </div>
        </div>

        {/* Floating Action Button */}
        <button className="absolute bottom-8 right-8 w-16 h-16 rounded-full protruding-btn-fab flex items-center justify-center text-white z-50 group">
          <Mic className="w-6 h-6 relative z-10" />
          <div className="absolute inset-0 rounded-full bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </button>

      </div>
    </AppLayout>
  );
}
