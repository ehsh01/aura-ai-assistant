import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { MicButton } from "@/components/MicButton";
import { useAiChat, useSummarizeNote, useSemanticSearch } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useRecallData } from "@/context/RecallDataContext";
import { firstName } from "@/lib/user-display";
import {
  filterNotesByNotebook,
  noteMatchesQuery,
  notesForSemanticSearch,
  noteUsesRichViewer,
  resolveNotesForAi,
  tasksForAiContext,
  type NotebookFilter,
  type RecallNote,
} from "@/lib/recall-context";
import { readSearchParam, notesPath } from "@/lib/recall-nav";
import { importEvernoteFiles } from "@/lib/evernote-import-ui";
import { NoteRichContent } from "@/components/NoteRichContent";
import { Download, Loader2, BookOpen, ChevronDown, Sparkles } from "lucide-react";

function notebookIdFromFilter(filter: NotebookFilter): string | null {
  if (filter === "all" || filter === "unfiled") return null;
  return filter;
}

const TAGS = ["All", "Work", "Personal", "Ideas", "Meeting", "Code", "Recipes"];

export function Notes() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const userName = firstName(user?.name);
  const { notes, notebooks, tasks, addNote, updateNote, importEnexUpload, isReady, loadNote } = useRecallData();
  const [activeTag, setActiveTag] = useState("All");
  const [activeNotebook, setActiveNotebook] = useState<NotebookFilter>("all");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [toolbarDraft, setToolbarDraft] = useState("");
  const [importing, setImporting] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [semanticMatchIds, setSemanticMatchIds] = useState<string[] | null>(null);
  const appliedSearchRef = useRef("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const summarizeNote = useSummarizeNote();
  const aiChat = useAiChat();
  const semanticSearch = useSemanticSearch();

  useEffect(() => {
    setEditingContent(false);
  }, [activeNoteId]);

  useEffect(() => {
    const search = window.location.search;
    if (appliedSearchRef.current === search) return;

    const noteId = readSearchParam("note");
    const notebookParam = readSearchParam("notebook");
    const qParam = readSearchParam("q");
    const pinned = readSearchParam("pinned") === "1";
    const isNew = readSearchParam("new") === "1";

    if (qParam) {
      setSearchQuery(qParam);
      setSemanticMatchIds(null);
    }

    if (notebookParam) {
      setActiveNotebook(notebookParam);
    } else {
      setActiveNotebook("all");
    }

    if (isNew) {
      appliedSearchRef.current = search;
      const notebookId = notebookParam && notebookParam !== "unfiled" ? notebookParam : null;
      const note = addNote({ title: "Untitled", content: "", tags: [], notebookId });
      setActiveNoteId(note.id);
      setAiSuggestion(null);
      return;
    }

    if (noteId) {
      if (!notes.some((n) => n.id === noteId)) return;
      appliedSearchRef.current = search;
      setActiveNoteId(noteId);
      return;
    }

    if (pinned) {
      appliedSearchRef.current = search;
      const firstPinned = notes.find((n) => n.pinned);
      if (firstPinned) setActiveNoteId(firstPinned.id);
      return;
    }

    appliedSearchRef.current = search;
  }, [location, notes, addNote]);

  useEffect(() => {
    if (notes.length === 0) {
      setActiveNoteId(null);
      return;
    }
    if (!activeNoteId || !notes.some((n) => n.id === activeNoteId)) {
      setActiveNoteId(notes[0]!.id);
    }
  }, [notes, activeNoteId]);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  useEffect(() => {
    if (!activeNoteId) return;
    const note = notes.find((n) => n.id === activeNoteId);
    if (!note || note.content) return;
    void loadNote(activeNoteId);
  }, [activeNoteId, loadNote, notes]);

  const handleNewNote = () => {
    const notebookId = notebookIdFromFilter(activeNotebook);
    const note = addNote({ title: "Untitled", content: "", tags: [], notebookId });
    setActiveNoteId(note.id);
    setAiSuggestion(null);
  };

  const handleEvernoteImport = (files: FileList | null) =>
    void importEvernoteFiles(files, {
      importing,
      setImporting,
      importFile: importEnexUpload,
      onSuccess: async (result) => {
        setActiveTag("All");
        setSearchQuery("");
        if (result.notebookId) navigate(notesPath({ notebook: result.notebookId }));
        if (result.firstNoteId) setActiveNoteId(result.firstNoteId);
      },
      onFinally: () => {
        if (importInputRef.current) importInputRef.current.value = "";
      },
    });

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
            userName,
            tasks: tasksForAiContext(tasks),
            notes: resolveNotesForAi({
              notes,
              searchQuery,
              activeNotebook,
              activeNote,
            }),
          },
        },
      });
      setAiSuggestion(res.message.content);
    } catch {
      setAiSuggestion("Recall AI is unavailable right now.");
    }
  };

  const handleSmartSearch = async () => {
    const q = searchQuery.trim();
    if (!q || semanticSearch.isPending) return;
    setSemanticMatchIds(null);
    try {
      const pool = filterNotesByNotebook(notes, activeNotebook);
      const res = await semanticSearch.mutateAsync({
        data: {
          query: q,
          items: notesForSemanticSearch(pool),
          limit: 15,
        },
      });
      setSemanticMatchIds(res.results.map((r) => r.id));
    } catch {
      setSemanticMatchIds([]);
    }
  };

  const notebookScopedNotes = filterNotesByNotebook(notes, activeNotebook);

  const filteredNotes = notebookScopedNotes.filter((note) => {
    const matchesTag = activeTag === "All" || note.tags.includes(activeTag);
    if (semanticMatchIds !== null) {
      return matchesTag && semanticMatchIds.includes(note.id);
    }
    return matchesTag && noteMatchesQuery(note, searchQuery);
  });

  const keywordOnlyMatches = notebookScopedNotes.filter(
    (note) =>
      (activeTag === "All" || note.tags.includes(activeTag)) &&
      noteMatchesQuery(note, searchQuery),
  );

  const unfiledCount = notes.filter((n) => !n.notebookId).length;
  const activeNotebookMeta =
    activeNotebook === "all"
      ? null
      : activeNotebook === "unfiled"
        ? { name: "Unfiled", noteCount: unfiledCount }
        : notebooks.find((nb) => nb.id === activeNotebook) ?? null;

  const pinnedNotes = filteredNotes.filter((n) => n.pinned);
  const recentNotes = filteredNotes.filter((n) => !n.pinned);

  return (
    <AppLayout>
      <div className="flex h-full w-full bg-[#0a0a0f] text-white">
        <div className="w-[300px] border-r border-white/[0.06] flex flex-col flex-shrink-0 bg-[#0a0a0f]/50">
          <div className="p-4 border-b border-white/[0.06] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white/90">Notes</h1>
                {!isReady ? (
                  <p className="text-xs text-white/30 mt-0.5">Loading…</p>
                ) : (
                  <p className="text-xs text-white/30 mt-0.5">
                    {activeNotebookMeta
                      ? `${activeNotebookMeta.noteCount} note${activeNotebookMeta.noteCount === 1 ? "" : "s"} in ${activeNotebookMeta.name}`
                      : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".enex,.xml,.ENEX,application/xml,text/xml,*/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleEvernoteImport(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={importing}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors disabled:opacity-50"
                  title="Import from Evernote (.enex)"
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 text-indigo-300 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 text-white/70" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleNewNote}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 hover:opacity-90 transition-opacity"
                  title="New Note"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5v14"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search notes (title, body, tags)..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSemanticMatchIds(null);
                }}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.05] transition-all"
              />
            </div>

            <div className="flex overflow-x-auto recall-scrollbar pb-2 -mb-2 gap-2">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(tag)}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    activeTag === tag
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                      : "bg-white/[0.03] text-white/40 border border-white/[0.05] hover:bg-white/[0.08]"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto recall-scrollbar p-3 space-y-6">
            {!isReady && (
              <div className="text-center py-12 px-4 text-sm text-white/40">Loading your notes…</div>
            )}

            {isReady && notes.length === 0 && (
              <div className="text-center py-12 px-4">
                <p className="text-sm text-white/40 mb-2">No notes yet</p>
                <p className="text-xs text-white/25 mb-4 leading-relaxed">
                  Import from Evernote: export a notebook as .enex, then use the import button above.
                </p>
                <button
                  type="button"
                  onClick={handleNewNote}
                  className="text-sm px-4 py-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30"
                >
                  Create your first note
                </button>
              </div>
            )}

            {isReady && filteredNotes.length === 0 && notes.length > 0 && (
              <div className="text-center py-8 px-4 text-sm text-white/40">
                {semanticMatchIds !== null && semanticMatchIds.length === 0
                  ? "Smart search found no related notes."
                  : "No notes match your search, tag, or notebook filter."}
                {searchQuery.trim() && keywordOnlyMatches.length === 0 && semanticMatchIds === null && (
                  <button
                    type="button"
                    onClick={() => void handleSmartSearch()}
                    disabled={semanticSearch.isPending}
                    className="flex items-center justify-center gap-2 mx-auto mt-4 px-4 py-2 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/25 disabled:opacity-50"
                  >
                    {semanticSearch.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Try smart search (uses AI)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTag("All");
                    setSearchQuery("");
                    setSemanticMatchIds(null);
                    setActiveNotebook("all");
                    navigate(notesPath());
                  }}
                  className="block mx-auto mt-3 text-indigo-300 hover:text-indigo-200"
                >
                  Clear filters
                </button>
              </div>
            )}

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

        <div className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/10 via-[#0a0a0f] to-[#0a0a0f]">
          {!activeNote ? (
            <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
              Select a note or create a new one to get started.
            </div>
          ) : (
            <>
              <div className="h-14 flex items-center justify-between px-6 border-b border-white/[0.02]">
                <div className="flex items-center gap-4 text-sm text-white/40">
                  <span>Last edited {activeNote.date}</span>
                </div>
                <NoteNotebookPicker
                  notebooks={notebooks}
                  value={activeNote.notebookId ?? null}
                  onChange={(notebookId) => updateNote(activeNote.id, { notebookId })}
                />
              </div>

              <div className="flex-1 overflow-y-auto recall-scrollbar p-10 lg:p-16 max-w-4xl mx-auto w-full">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={(e) => updateNote(activeNote.id, { title: e.target.value })}
                  placeholder="Note title"
                  className="w-full bg-transparent text-3xl font-semibold text-white/95 mb-6 outline-none border-none placeholder:text-white/20"
                />

                {noteUsesRichViewer(activeNote) && !editingContent ? (
                  <div className="mb-6">
                    <div className="flex justify-end mb-2">
                      <button
                        type="button"
                        onClick={() => setEditingContent(true)}
                        className="text-xs text-indigo-300 hover:text-indigo-200 px-3 py-1 rounded-lg border border-indigo-500/30"
                      >
                        Edit text
                      </button>
                    </div>
                    <NoteRichContent
                      noteId={activeNote.id}
                      content={activeNote.content}
                      contentFormat={activeNote.contentFormat}
                    />
                  </div>
                ) : (
                  <div className="mb-6">
                    {noteUsesRichViewer(activeNote) && (
                      <div className="flex justify-end mb-2">
                        <button
                          type="button"
                          onClick={() => setEditingContent(false)}
                          className="text-xs text-indigo-300 hover:text-indigo-200 px-3 py-1 rounded-lg border border-indigo-500/30"
                        >
                          View with images
                        </button>
                      </div>
                    )}
                    <textarea
                      value={activeNote.content}
                      onChange={(e) => updateNote(activeNote.id, { content: e.target.value })}
                      placeholder="Start writing..."
                      className="w-full min-h-[320px] bg-transparent text-base text-white/80 leading-relaxed outline-none resize-none placeholder:text-white/25"
                    />
                  </div>
                )}

                <div className="my-8 p-5 rounded-xl bg-indigo-900/10 border border-indigo-500/20 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
                  <div className="flex items-start gap-3 pl-2">
                    <div>
                      <h4 className="text-sm font-semibold text-indigo-300 mb-1">Recall Suggestion</h4>
                      <p className="text-sm text-indigo-200/70 leading-relaxed m-0 whitespace-pre-wrap">
                        {aiSuggestion ??
                          (searchQuery.trim()
                            ? `Search active — AI will use matching notes (${Math.min(keywordOnlyMatches.length, 15)} max). Summarize or ask below.`
                            : "Use Summarize or ask Recall in the toolbar below for AI help with this note.")}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl">
                <div className="ai-toolbar-wrap flex items-center gap-2 p-2 shadow-2xl shadow-indigo-500/10">
                  <button
                    type="button"
                    onClick={() => void handleSummarize()}
                    disabled={summarizeNote.isPending || !activeNote.content}
                    className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-indigo-300 transition-colors disabled:opacity-50"
                    title="Summarize"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </button>

                  <div className="h-6 w-px bg-white/10 mx-2" />

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

                  <MicButton
                    onTranscript={(text) =>
                      setToolbarDraft((prev) => (prev ? `${prev} ${text}` : text))
                    }
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
                    title="Voice input"
                  />

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
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function NoteNotebookPicker({
  notebooks,
  value,
  onChange,
}: {
  notebooks: { id: string; name: string; source: string }[];
  value: string | null;
  onChange: (notebookId: string | null) => void;
}) {
  return (
    <div className="relative flex items-center">
      <BookOpen className="w-3.5 h-3.5 text-white/30 absolute left-3 pointer-events-none" />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="appearance-none pl-8 pr-8 py-1.5 rounded-lg text-sm bg-white/[0.05] border border-white/[0.08] text-white/70 hover:bg-white/[0.08] focus:outline-none focus:border-indigo-500/40 transition-colors cursor-pointer max-w-[220px]"
        title="Assign to notebook"
      >
        <option value="">Unfiled</option>
        {notebooks.map((nb) => (
          <option key={nb.id} value={nb.id}>
            {nb.name}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-white/30 absolute right-2.5 pointer-events-none" />
    </div>
  );
}

function NoteCard({
  note,
  isActive,
  onClick,
  index,
}: {
  note: RecallNote;
  isActive: boolean;
  onClick: () => void;
  index: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl recall-glass-card animate-recall-fade-in group relative overflow-hidden ${isActive ? "recall-note-active" : ""}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-indigo-500 rounded-l-xl" />
      )}
      <div className="flex justify-between items-start mb-1">
        <h4 className="text-sm font-semibold text-white/90 truncate pr-4">{note.title}</h4>
        {note.pinned && (
          <svg className="text-indigo-400 flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 11.2V6a3 3 0 0 0-6 0v5.2a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        )}
      </div>
      <p className="text-xs text-white/40 line-clamp-2 mb-3 leading-relaxed">
        {note.preview || "Empty note"}
      </p>
      <div className="flex items-center justify-between mt-auto">
        <div className="flex gap-1.5 overflow-hidden">
          {note.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 whitespace-nowrap">
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-white/30 flex-shrink-0 ml-2">{note.date}</span>
      </div>
    </button>
  );
}
