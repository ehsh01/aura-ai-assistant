import React, { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAiChat, useSummarizeNote } from "@workspace/api-client-react";
import {
  MOCK_NOTES,
  MOCK_TASKS,
  RECALL_USER_NAME,
  notesForAiContext,
  tasksForAiContext,
} from "@/lib/recall-context";

const TAGS = ["All", "Work", "Personal", "Ideas", "Meeting", "Code", "Recipes"];

const NOTES = MOCK_NOTES;

export function Notes() {
  const [activeTag, setActiveTag] = useState("All");
  const [activeNoteId, setActiveNoteId] = useState("1");
  const [searchQuery, setSearchQuery] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [toolbarDraft, setToolbarDraft] = useState("");
  const summarizeNote = useSummarizeNote();
  const aiChat = useAiChat();

  const activeNote = NOTES.find((n) => n.id === activeNoteId) ?? NOTES[0];

  const handleSummarize = async () => {
    if (!activeNote?.content) return;
    try {
      const res = await summarizeNote.mutateAsync({
        data: { content: activeNote.content, maxLength: 500 },
      });
      setAiSuggestion(res.summary);
    } catch {
      setAiSuggestion("Could not summarize — check that the API is running.");
    }
  };

  const handleToolbarSend = async () => {
    const text = toolbarDraft.trim();
    if (!text || aiChat.isPending) return;
    setToolbarDraft("");
    try {
      const res = await aiChat.mutateAsync({
        data: {
          messages: [{ role: "user", content: text }],
          context: {
            userName: RECALL_USER_NAME,
            tasks: tasksForAiContext(MOCK_TASKS),
            notes: notesForAiContext(NOTES),
          },
        },
      });
      setAiSuggestion(res.message.content);
    } catch {
      setAiSuggestion("Recall AI is unavailable right now.");
    }
  };

  const filteredNotes = NOTES.filter(note => {
    const matchesTag = activeTag === "All" || note.tags.includes(activeTag);
    const matchesSearch = note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          note.preview.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTag && matchesSearch;
  });

  const pinnedNotes = filteredNotes.filter(n => n.pinned);
  const recentNotes = filteredNotes.filter(n => !n.pinned);

  return (
    <AppLayout>
      <div className="flex h-full w-full bg-[#0a0a0f] text-white">
        
        {/* Left Panel - Note List */}
        <div className="w-[300px] border-r border-white/[0.06] flex flex-col flex-shrink-0 bg-[#0a0a0f]/50">
          
          {/* Header */}
          <div className="p-4 border-b border-white/[0.06] space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold tracking-tight text-white/90">Notes</h1>
              <div className="flex items-center gap-2">
                <button className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/70 hover:text-white" title="Voice Note">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" x2="12" y1="19" y2="22"/>
                  </svg>
                </button>
                <button className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 hover:opacity-90 transition-opacity animate-recall-fade-in" title="New Note">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5v14"/>
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Search */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </div>
              <input 
                type="text" 
                placeholder="Search notes or ask Recall..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
              />
            </div>

            {/* Tags */}
            <div className="flex overflow-x-auto recall-scrollbar pb-2 -mb-2 gap-2">
              {TAGS.map(tag => (
                <button 
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTag === tag 
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' 
                      : 'bg-white/[0.03] text-white/40 border border-white/[0.05] hover:bg-white/[0.08]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto recall-scrollbar p-3 space-y-6">
            
            {pinnedNotes.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] font-semibold text-white/30 uppercase tracking-wider px-1">Pinned</h3>
                <div className="space-y-2">
                  {pinnedNotes.map((note, i) => (
                    <NoteCard key={note.id} note={note} isActive={activeNoteId === note.id} onClick={() => setActiveNoteId(note.id)} index={i} />
                  ))}
                </div>
              </div>
            )}

            {recentNotes.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[11px] font-semibold text-white/30 uppercase tracking-wider px-1">Recent</h3>
                <div className="space-y-2">
                  {recentNotes.map((note, i) => (
                    <NoteCard key={note.id} note={note} isActive={activeNoteId === note.id} onClick={() => setActiveNoteId(note.id)} index={i + pinnedNotes.length} />
                  ))}
                </div>
              </div>
            )}
            
          </div>
        </div>

        {/* Right Panel - Editor */}
        <div className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#0a0a0f] to-[#0a0a0f]">
          
          {/* Top Actions */}
          <div className="h-14 flex items-center justify-between px-6 border-b border-white/[0.02]">
            <div className="flex items-center gap-4 text-sm text-white/40">
              <span>Last edited 10m ago</span>
              <span className="w-1 h-1 rounded-full bg-white/10"></span>
              <span>124 words</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 text-white/40 hover:text-white/80 rounded-lg hover:bg-white/5 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" x2="12" y1="2" y2="15"/>
                </svg>
              </button>
              <button className="p-2 text-white/40 hover:text-white/80 rounded-lg hover:bg-white/5 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1"/>
                  <circle cx="19" cy="12" r="1"/>
                  <circle cx="5" cy="12" r="1"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 overflow-y-auto recall-scrollbar p-10 lg:p-16 max-w-4xl mx-auto w-full prose-recall">
            <div className="animate-recall-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="flex gap-2 mb-6">
                <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-300 text-xs font-medium border border-indigo-500/20">Work</span>
                <span className="px-2.5 py-1 rounded-md bg-white/5 text-white/50 text-xs font-medium border border-white/10">Meeting</span>
              </div>
              
              <h1 contentEditable suppressContentEditableWarning>Project Recall Q3 Strategy</h1>
              
              <p contentEditable suppressContentEditableWarning>
                We need to align on the upcoming Q3 deliverables for the Recall assistant. The core focus will be on improving context-aware processing by integrating better local caching mechanisms. This should drastically reduce perceived latency during complex, multi-turn conversational flows.
              </p>

              <h2 contentEditable suppressContentEditableWarning>Key Objectives</h2>
              <ul>
                <li contentEditable suppressContentEditableWarning>Implement SQLite-based local vector storage for fast semantic retrieval.</li>
                <li contentEditable suppressContentEditableWarning>Refine the glassmorphic UI components to ensure 60fps animations.</li>
                <li contentEditable suppressContentEditableWarning>Draft the new privacy policy concerning local data handling.</li>
              </ul>

              <div className="my-8 p-5 rounded-xl bg-indigo-900/10 border border-indigo-500/20 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                <div className="flex items-start gap-3">
                  <svg className="mt-1 flex-shrink-0 text-indigo-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
                  </svg>
                  <div>
                    <h4 className="text-sm font-semibold text-indigo-300 mb-1">Recall Suggestion</h4>
                    <p className="text-sm text-indigo-200/70 leading-relaxed m-0">
                      {aiSuggestion ??
                        "Use Summarize or ask Recall in the toolbar below for AI help with this note."}
                    </p>
                  </div>
                </div>
              </div>

              <h2 contentEditable suppressContentEditableWarning>Code Snippet</h2>
              <div className="bg-[#050508] border border-white/10 rounded-xl p-4 my-6 font-mono text-sm text-white/70 overflow-x-auto relative group">
                <button className="absolute top-3 right-3 p-1.5 rounded-md bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 text-white/50">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                  </svg>
                </button>
<pre><code><span className="text-pink-400">const</span> <span className="text-blue-400">fetchLocalVectors</span> <span className="text-white">=</span> <span className="text-pink-400">async</span> (query: <span className="text-teal-300">string</span>) <span className="text-blue-400">=&gt;</span> {'{'}
  <span className="text-pink-400">const</span> embeddings <span className="text-white">=</span> <span className="text-pink-400">await</span> model.embed(query);
  <span className="text-pink-400">return</span> db.query(<span className="text-green-300">'SELECT * FROM vectors ORDER BY similarity DESC LIMIT 5'</span>);
{'}'}</code></pre>
              </div>

            </div>
          </div>

          {/* AI Toolbar */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl">
            <div className="ai-toolbar-wrap flex items-center gap-2 p-2 shadow-2xl shadow-indigo-500/10">
              <button
                type="button"
                onClick={() => void handleSummarize()}
                disabled={summarizeNote.isPending}
                className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-indigo-300 transition-colors disabled:opacity-50"
                title="Summarize"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              <button className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-purple-300 transition-colors" title="Improve Writing">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                </svg>
              </button>
              
              <div className="h-6 w-px bg-white/10 mx-2"></div>
              
              <div className="flex-1 relative">
                <input 
                  type="text" 
                  placeholder="Ask Recall to write, brainstorm, or edit..." 
                  value={toolbarDraft}
                  onChange={(e) => setToolbarDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleToolbarSend();
                  }}
                  className="w-full bg-transparent border-none text-sm text-white/90 placeholder:text-white/40 focus:outline-none focus:ring-0 px-2 py-1"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleToolbarSend()}
                disabled={aiChat.isPending || !toolbarDraft.trim()}
                className="w-8 h-8 rounded-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white flex items-center justify-center transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5v14"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Related Notes floating button */}
          <button className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.08] hover:border-white/10 backdrop-blur-md transition-all group">
            <svg className="text-indigo-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span className="text-sm font-medium text-white/70 group-hover:text-white/90">2 Related</span>
          </button>

        </div>
      </div>
    </AppLayout>
  );
}

function NoteCard({ note, isActive, onClick, index }: { note: any, isActive: boolean, onClick: () => void, index: number }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl recall-glass-card animate-recall-fade-in group relative overflow-hidden ${isActive ? 'recall-note-active' : ''}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-indigo-500 rounded-l-xl"></div>
      )}
      <div className="flex justify-between items-start mb-1">
        <h4 className="text-sm font-semibold text-white/90 truncate pr-4">{note.title}</h4>
        {note.pinned && (
          <svg className="text-indigo-400 flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 11.2V6a3 3 0 0 0-6 0v5.2a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
          </svg>
        )}
      </div>
      <p className="text-xs text-white/40 line-clamp-2 mb-3 leading-relaxed">
        {note.preview}
      </p>
      <div className="flex items-center justify-between mt-auto">
        <div className="flex gap-1.5 overflow-hidden">
          {note.tags.slice(0, 2).map((tag: string) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 whitespace-nowrap">
              {tag}
            </span>
          ))}
          {note.tags.length > 2 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">+{note.tags.length - 2}</span>
          )}
        </div>
        <span className="text-[10px] text-white/30 flex-shrink-0 ml-2">{note.date}</span>
      </div>
    </button>
  );
}
