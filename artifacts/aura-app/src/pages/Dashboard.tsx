import React, { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Search, Mic, Bell, Calendar, CheckCircle2, Circle, MoreHorizontal, MessageSquare, Sparkles, Pin, Plus, CheckSquare, FileText, Clock } from "lucide-react";
import { Link } from "wouter";

export function Dashboard() {
  const [searchFocused, setSearchFocused] = useState(false);

  const stats = [
    { id: 1, value: "3", label: "tasks due", icon: <CheckSquare className="w-5 h-5 text-emerald-400" /> },
    { id: 2, value: "2", label: "new notes", icon: <FileText className="w-5 h-5 text-indigo-400" /> },
    { id: 3, value: "1", label: "meeting at 2pm", icon: <Clock className="w-5 h-5 text-pink-400" /> },
  ];

  const pinnedNotes = [
    {
      id: 1,
      title: "Product Strategy Q3",
      content: "Focus on AI integration and lowering latency for first byte. Need to discuss the new architectural patterns with engineering team before Friday.",
      date: "2h ago",
      tags: ["Strategy", "Work"],
      tilt: "rotate-1",
      glowColor: "rgba(124, 58, 237, 0.5)"
    },
    {
      id: 2,
      title: "Design System v2",
      content: "Updated color palette and refined component tokens. The new spacing scale is ready for review by the design sync tomorrow.",
      date: "2d ago",
      tags: ["Design"],
      tilt: "-rotate-1",
      glowColor: "rgba(219, 39, 119, 0.5)"
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
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.6)]";
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
            <div className={`nebula-glass rounded-full px-5 py-3 flex items-center transition-all duration-300 nebula-search-container ${searchFocused ? 'bg-white/[0.08]' : ''}`}>
              <Search className={`w-5 h-5 mr-3 transition-colors ${searchFocused ? 'text-indigo-300' : 'text-zinc-400'}`} />
              <input 
                type="text" 
                placeholder="Ask Aura anything..." 
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-500 w-full font-medium"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <button className="relative w-14 h-14 rounded-full bg-indigo-500/20 text-indigo-200 flex items-center justify-center border border-indigo-400/30 hover:bg-indigo-500/30 transition-colors group cursor-pointer nebula-float mic-halo mic-pulse z-30">
              <Mic className="w-6 h-6" />
            </button>

            <button className="w-10 h-10 rounded-full nebula-glass flex items-center justify-center text-zinc-300 hover:text-white transition-colors relative z-20">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-pink-500 rounded-full shadow-[0_0_5px_rgba(236,72,153,0.8)]"></span>
            </button>
            
            <div className="w-10 h-10 rounded-full nebula-glass flex items-center justify-center text-sm font-bold text-indigo-200 z-20 shadow-[0_0_15px_rgba(99,102,241,0.3)] cursor-pointer">
              AM
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-12 pt-4 z-10 relative dashboard-hide-scrollbar">
          <div className="max-w-6xl mx-auto space-y-12">
            
            {/* Greeting */}
            <section className="flex flex-col items-center text-center space-y-4">
              <h1 className="text-5xl md:text-6xl font-semibold tracking-tight text-gradient-nebula mb-2">
                Good morning, Alex <span className="text-indigo-400 text-4xl inline-block ml-2 animate-pulse">✦</span>
              </h1>
              <div className="flex items-center gap-2 text-indigo-200/60 font-light tracking-wide text-sm">
                <Calendar className="w-4 h-4" />
                <span>{currentDate}</span>
              </div>
              <p className="text-lg text-zinc-300 italic font-light max-w-2xl mt-4 leading-relaxed mix-blend-screen">
                "Clarity comes from action, not thought. Here's what needs your attention today."
              </p>
            </section>

            {/* Stats Row */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {stats.map(stat => (
                <div key={stat.id} className="nebula-glass nebula-glass-hover rounded-3xl p-6 flex items-center gap-5 cursor-pointer">
                  <div className="w-12 h-12 nebula-pill flex items-center justify-center flex-shrink-0">
                    {stat.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-3xl font-bold text-white tracking-tight">{stat.value}</span>
                    <span className="text-sm text-zinc-400 font-light uppercase tracking-wider">{stat.label}</span>
                  </div>
                </div>
              ))}
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
                    {pinnedNotes.map((note) => (
                      <div key={note.id} className={`nebula-glass nebula-glass-hover rounded-3xl p-6 flex flex-col h-56 transform ${note.tilt} transition-all duration-300 cursor-pointer`} style={{ borderTop: `2px solid ${note.glowColor}` }}>
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="font-semibold text-lg text-zinc-100">{note.title}</h3>
                          <button className="text-zinc-500 hover:text-white transition-colors">
                            <MoreHorizontal className="w-5 h-5" />
                          </button>
                        </div>
                        <p className="text-sm text-zinc-400 font-light leading-relaxed mb-auto line-clamp-3">
                          {note.content}
                        </p>
                        <div className="flex items-center justify-between mt-4">
                          <span className="text-xs text-zinc-500 font-light">
                            {note.date}
                          </span>
                          <div className="flex gap-2">
                            {note.tags.map(tag => (
                              <span key={tag} className="nebula-pill text-[10px] font-medium px-3 py-1 text-zinc-300">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Add New Note Card - Floating */}
                    <div className="absolute -bottom-4 right-0 transform translate-y-1/2 translate-x-1/2 md:translate-x-0 z-20">
                       <Link href="/notes">
                         <button className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-[0_10px_30px_rgba(124,58,237,0.5)] hover:shadow-[0_15px_40px_rgba(124,58,237,0.7)] transition-all nebula-float group border border-white/20">
                            <Plus className="w-8 h-8 group-hover:scale-110 transition-transform" />
                         </button>
                       </Link>
                    </div>
                  </div>
                </section>

                {/* Recent Notes Strip */}
                <section className="pt-4">
                  <h2 className="text-sm font-light text-zinc-400 uppercase tracking-widest mb-4">Flow State</h2>
                  <div className="flex gap-4 overflow-x-auto dashboard-hide-scrollbar pb-4">
                    {recentNotes.map((note) => (
                      <div key={note.id} className="flex-none w-56 nebula-glass nebula-glass-hover rounded-2xl p-4 cursor-pointer group">
                        <div className="flex flex-col h-full">
                          <div className="flex items-center justify-between mb-3">
                            <div className="w-8 h-8 nebula-pill flex items-center justify-center">
                              <FileText className="w-4 h-4 text-zinc-400 group-hover:text-indigo-300 transition-colors" />
                            </div>
                            <span className="text-xs text-zinc-500 font-light">{note.date}</span>
                          </div>
                          <h3 className="font-medium text-sm text-zinc-200 group-hover:text-white transition-colors line-clamp-2">{note.title}</h3>
                        </div>
                      </div>
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
                      <div key={task.id} className="group flex items-start gap-4 p-4 nebula-glass rounded-2xl hover:border-indigo-500/30 transition-all cursor-pointer">
                        <button className="mt-0.5 text-zinc-500 group-hover:text-emerald-400 transition-colors flex-shrink-0">
                          <Circle className="w-5 h-5" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{task.title}</p>
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${getPriorityColor(task.priority)}`} />
                      </div>
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
                <div className="nebula-pill p-1.5"><MessageSquare className="w-3.5 h-3.5 text-pink-400" /></div> Recent with Aura
              </h2>
              <div className="flex flex-wrap gap-4">
                {aiConversations.map((conv, idx) => (
                  <div key={idx} className="nebula-glass nebula-glass-hover rounded-full px-5 py-3 text-sm text-zinc-200 cursor-pointer flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span className="truncate max-w-md font-light">{conv}</span>
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
