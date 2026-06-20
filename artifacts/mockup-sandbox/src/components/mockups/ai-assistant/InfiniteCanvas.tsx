import React, { useState } from "react";
import { AppLayout, Page } from "./_shared/AppLayout";
import "./canvas-group.css";
import {
  ZoomIn,
  ZoomOut,
  MousePointer2,
  StickyNote,
  CheckSquare,
  Spline,
  Type,
  Image as ImageIcon,
  Maximize,
  Share2,
  Sparkles,
  ChevronRight,
  Send,
  MoreHorizontal,
  Plus
} from "lucide-react";

export function InfiniteCanvas() {
  const [aiExpanded, setAiExpanded] = useState(false);

  return (
    <AppLayout activePage="canvas">
      <div className="relative flex flex-col h-full bg-[#0a0a0f] overflow-hidden font-sans text-white">
        
        {/* Top Header */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 h-14 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-md z-20">
          <div className="flex items-center gap-3">
            <h1 className="font-medium text-[15px] tracking-tight text-white/90">Canvas</h1>
            <ChevronRight className="w-4 h-4 text-white/30" />
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.04]">
              <span className="text-[13px] text-indigo-300 font-medium">Q3 Planning</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-lg p-0.5">
              <button className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.05] rounded-md transition-colors">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[12px] font-medium text-white/60 w-10 text-center">100%</span>
              <button className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.05] rounded-md transition-colors">
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div className="h-4 w-px bg-white/[0.1]"></div>

            <div className="flex items-center gap-1">
              <button className="p-2 text-white/40 hover:text-white/80 transition-colors">
                <Maximize className="w-4 h-4" />
              </button>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white text-[13px] font-medium transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>
          </div>
        </header>

        {/* Canvas Area */}
        <div 
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1.5px, transparent 1.5px)",
            backgroundSize: "32px 32px",
            backgroundPosition: "0 0"
          }}
        >
          {/* SVG Connections */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {/* Note to Task */}
            <path 
              d="M 320 220 C 400 220, 380 180, 480 180" 
              fill="none" 
              stroke="rgba(165,180,252,0.4)" 
              strokeWidth="2"
              strokeDasharray="4 4"
            />
            {/* Note to Event */}
            <path 
              d="M 280 280 C 280 360, 200 360, 200 420" 
              fill="none" 
              stroke="rgba(255,255,255,0.2)" 
              strokeWidth="2"
            />
            {/* Note to Idea */}
            <path 
              d="M 400 280 C 450 350, 500 300, 600 350" 
              fill="none" 
              stroke="rgba(251,191,36,0.5)" 
              strokeWidth="2"
            />
            {/* Note to Cluster */}
            <path 
              d="M 240 220 C 150 220, 150 280, 100 320" 
              fill="none" 
              stroke="rgba(255,255,255,0.15)" 
              strokeWidth="2"
            />
          </svg>

          {/* Canvas Elements Container */}
          <div className="absolute inset-0" style={{ transform: "translate(100px, 50px)" }}>
            
            {/* Note Card 1 */}
            <div className="absolute top-[100px] left-[120px] w-64 bg-[#14141c] border border-white/[0.08] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden transition-transform hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(99,102,241,0.15)] group z-10" style={{ transform: "rotate(-2deg)" }}>
              <div className="h-1 w-full bg-indigo-500"></div>
              <div className="p-4">
                <h3 className="text-[14px] font-medium text-white/90 mb-2">Product roadmap ideas</h3>
                <p className="text-[13px] text-white/60 leading-relaxed">
                  Focus on AI integration in the editor. Need to explore spatial layouts and infinite canvas features.
                </p>
              </div>
            </div>

            {/* Note Card 2 */}
            <div className="absolute top-[280px] left-[150px] w-56 bg-[#14141c] border border-white/[0.08] rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden transition-transform hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(167,139,250,0.15)] z-10" style={{ transform: "rotate(1deg)" }}>
              <div className="h-1 w-full bg-violet-500"></div>
              <div className="p-4">
                <h3 className="text-[14px] font-medium text-white/90 mb-2">Q3 goals</h3>
                <ul className="text-[13px] text-white/60 space-y-1.5 list-disc list-inside ml-2">
                  <li>Launch beta</li>
                  <li>Reach 10k users</li>
                  <li>Finalize pricing</li>
                </ul>
              </div>
            </div>

            {/* Task Card */}
            <div className="absolute top-[80px] left-[480px] w-72 bg-[#121218] border border-white/[0.1] rounded-lg shadow-xl z-10">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                  <span className="text-[13px] font-medium text-white/80">Action Items</span>
                </div>
                <button className="text-white/30 hover:text-white/70"><Plus className="w-4 h-4" /></button>
              </div>
              <div className="p-2">
                {[
                  { id: 1, text: "Draft announcement blog", done: true },
                  { id: 2, text: "Review user feedback", done: false },
                  { id: 3, text: "Update marketing site", done: false }
                ].map(task => (
                  <div key={task.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.03] rounded-md group">
                    <div className={`w-4 h-4 rounded-[4px] border ${task.done ? 'bg-indigo-500 border-indigo-500' : 'border-white/20'} flex items-center justify-center`}>
                      {task.done && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <span className={`text-[13px] ${task.done ? 'text-white/30 line-through' : 'text-white/70'}`}>{task.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Event Card */}
            <div className="absolute top-[370px] left-[70px] w-48 bg-[#1a1525] border border-violet-500/30 rounded-xl shadow-[0_8px_30px_rgba(139,92,246,0.15)] overflow-hidden z-10">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="mt-1 w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]"></div>
                <div>
                  <h4 className="text-[13px] font-medium text-violet-100">Team sync</h4>
                  <p className="text-[12px] text-violet-300/70 mt-0.5">Thu 2:00 PM</p>
                </div>
              </div>
            </div>

            {/* Idea Bubble */}
            <div className="absolute top-[310px] left-[520px] w-64 bg-[#231b12] border border-amber-500/20 rounded-[24px] rounded-tl-sm p-5 shadow-[0_8px_30px_rgba(245,158,11,0.08)] z-10">
              <div className="flex items-center gap-2 mb-2 text-amber-400">
                <Sparkles className="w-4 h-4" />
                <span className="text-[12px] font-medium uppercase tracking-wider">Brainstorm</span>
              </div>
              <p className="text-[14px] text-amber-100/90 leading-relaxed">
                What if we used the canvas for memory? A spatial mapping of conversation history instead of a linear chat log.
              </p>
            </div>

            {/* Linked Notes Cluster */}
            <div className="absolute top-[180px] left-[-150px] z-0">
              <div className="absolute -top-6 left-4 text-[11px] font-medium text-white/40 uppercase tracking-widest bg-[#0a0a0f] px-2 py-0.5 border border-white/[0.05] rounded-full">Research Context</div>
              <div className="relative w-52 h-40">
                <div className="absolute top-0 left-0 w-48 bg-[#14141c] border border-white/[0.06] p-3 rounded-lg shadow-lg rotate-[-6deg] opacity-60">
                  <div className="h-2 w-12 bg-white/10 rounded mb-2"></div>
                  <div className="h-2 w-full bg-white/5 rounded mb-1"></div>
                  <div className="h-2 w-3/4 bg-white/5 rounded"></div>
                </div>
                <div className="absolute top-4 left-4 w-48 bg-[#14141c] border border-white/[0.06] p-3 rounded-lg shadow-lg rotate-[3deg] opacity-80">
                  <div className="h-2 w-16 bg-white/20 rounded mb-2"></div>
                  <div className="h-2 w-full bg-white/10 rounded mb-1"></div>
                  <div className="h-2 w-5/6 bg-white/10 rounded"></div>
                </div>
                <div className="absolute top-8 left-8 w-48 bg-[#14141c] border border-white/[0.1] p-4 rounded-lg shadow-xl">
                  <h4 className="text-[13px] font-medium text-white/90 mb-1.5">Competitor Analysis</h4>
                  <p className="text-[12px] text-white/50">Detailed breakdown of spatial tools.</p>
                </div>
              </div>
            </div>

          </div>

          {/* Left Mini-toolbar */}
          <div className="absolute top-1/2 left-4 -translate-y-1/2 flex flex-col gap-1.5 p-1.5 bg-[#14141c]/80 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-2xl z-20">
            <button className="p-2.5 rounded-lg bg-indigo-500/20 text-indigo-300 transition-colors tooltip-trigger relative group">
              <MousePointer2 className="w-[18px] h-[18px]" />
              <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-black text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Select (V)</span>
            </button>
            <button className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors tooltip-trigger relative group">
              <StickyNote className="w-[18px] h-[18px]" />
            </button>
            <button className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors tooltip-trigger relative group">
              <Type className="w-[18px] h-[18px]" />
            </button>
            <button className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors tooltip-trigger relative group">
              <CheckSquare className="w-[18px] h-[18px]" />
            </button>
            <button className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors tooltip-trigger relative group">
              <Spline className="w-[18px] h-[18px]" />
            </button>
            <div className="w-full h-px bg-white/[0.1] my-1"></div>
            <button className="p-2.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors tooltip-trigger relative group">
              <ImageIcon className="w-[18px] h-[18px]" />
            </button>
          </div>

          {/* Mini-map */}
          <div className="absolute bottom-16 right-4 w-36 h-24 bg-[#0a0a0f]/90 backdrop-blur-md border border-white/[0.1] rounded-lg shadow-2xl z-20 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.2)_1px,transparent_1px)] bg-[size:8px_8px] opacity-30"></div>
            {/* Dots representing content */}
            <div className="absolute top-6 left-8 w-6 h-4 bg-indigo-500/40 rounded-sm"></div>
            <div className="absolute top-12 left-10 w-5 h-5 bg-violet-500/40 rounded-sm"></div>
            <div className="absolute top-5 left-16 w-8 h-8 bg-white/20 rounded-sm"></div>
            <div className="absolute top-14 left-20 w-6 h-5 bg-amber-500/40 rounded-sm"></div>
            {/* Viewport Indicator */}
            <div className="absolute top-2 left-4 w-20 h-14 border border-indigo-500 bg-indigo-500/10 rounded animate-map-viewport-pulse"></div>
          </div>

          {/* Floating AI Panel */}
          <div className="absolute bottom-4 right-4 flex flex-col items-end z-30">
            {aiExpanded ? (
              <div className="w-[340px] bg-[#14141c]/95 backdrop-blur-2xl border border-indigo-500/30 rounded-2xl shadow-[0_20px_60px_-15px_rgba(99,102,241,0.3)] overflow-hidden mb-4 transform transition-all duration-300 origin-bottom-right">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-gradient-to-r from-indigo-500/10 to-transparent">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center">
                      <Sparkles className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-[13px] font-medium text-white/90">Aura</span>
                  </div>
                  <button onClick={() => setAiExpanded(false)} className="text-white/40 hover:text-white/80 p-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <div className="p-4 h-40 flex flex-col justify-end">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex-shrink-0 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                    </div>
                    <div className="bg-white/[0.04] border border-white/[0.04] p-3 rounded-2xl rounded-tl-none text-[13px] text-white/80">
                      I've analyzed your Q3 Planning. Would you like me to generate a timeline based on these notes?
                    </div>
                  </div>
                </div>
                <div className="p-3 border-t border-white/[0.06] bg-black/20">
                  <div className="relative flex items-center">
                    <input 
                      type="text" 
                      placeholder="Ask Aura about this canvas..." 
                      className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl pl-4 pr-10 py-2.5 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                    />
                    <button className="absolute right-2 p-1.5 bg-indigo-500 rounded-lg text-white hover:bg-indigo-400 transition-colors">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setAiExpanded(true)}
                className="group flex items-center gap-3 bg-[#14141c]/90 backdrop-blur-xl border border-indigo-500/30 px-4 py-3 rounded-full shadow-2xl hover:bg-[#1a1a24] transition-all animate-ai-pulse-glow"
              >
                <Sparkles className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300" />
                <span className="text-[13px] font-medium text-white/80 group-hover:text-white">Ask Aura...</span>
              </button>
            )}
          </div>

        </div>

        {/* Bottom Status Bar */}
        <footer className="flex-shrink-0 flex items-center justify-between px-4 h-8 bg-[#0a0a0f] border-t border-white/[0.06] z-20">
          <div className="flex items-center gap-4 text-[11px] text-white/40">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Saved</span>
            <span>Q3 Planning</span>
            <span>14 nodes, 8 connections</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="text-[11px] text-white/40 hover:text-white/80 transition-colors">Help</button>
            <button className="text-[11px] text-white/40 hover:text-white/80 transition-colors">Shortcuts</button>
          </div>
        </footer>

      </div>
    </AppLayout>
  );
}
