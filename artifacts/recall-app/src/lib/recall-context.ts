/** Types and AI context helpers for Recall notes and tasks. */

export interface RecallTask {
  id: string;
  title: string;
  time?: string;
  priority: "high" | "med" | "low" | "none";
  tags?: string[];
  completed: boolean;
  projectId?: string | null;
  requesterPersonId?: string | null;
  requesterPersonName?: string | null;
}

export interface RecallNote {
  id: string;
  title: string;
  preview: string;
  content: string;
  contentFormat?: "plain" | "html";
  tags: string[];
  date: string;
  pinned: boolean;
  notebookId?: string | null;
  projectId?: string | null;
  attachmentCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecallNotebook {
  id: string;
  name: string;
  source: string;
  noteCount: number;
  date: string;
}

export interface RecallProject {
  id: string;
  name: string;
  description?: string | null;
  status: "active" | "paused" | "archived";
  relatedPeople: string[];
  noteCount: number;
  taskCount: number;
  captureCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecallCaptureItem {
  id: string;
  rawText: string;
  cleanedTitle: string;
  suggestedType: "note" | "task" | "reminder" | "work_note" | "project_item" | "reference";
  suggestedPriority: "low" | "medium" | "high" | "urgent";
  suggestedDueDate?: string | null;
  suggestedProject?: string | null;
  suggestedTags: string[];
  suggestedActions: string[];
  suggestedPersonName?: string | null;
  status: "pending" | "accepted" | "dismissed";
  projectId?: string | null;
  notebookId?: string | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Whether the note viewer should render HTML + attachments instead of a plain textarea. */
export function noteUsesRichViewer(note: Pick<RecallNote, "content" | "contentFormat" | "id">): boolean {
  if (note.contentFormat === "html") return true;
  if (note.content.includes("data-recall-attachment")) return true;
  if (/<(?:div|img|ul|ol|li|br|p|a|h[1-6]|table)\b/i.test(note.content)) return true;
  if (note.id.startsWith("note-en-")) return true;
  return false;
}

export type NotebookFilter = "all" | "unfiled" | string;

/** Default cap for notes sent to AI chat (token cost control). */
export const AI_NOTES_CONTEXT_LIMIT = 15;

/** Max notes embedded for optional smart search (cost control). */
export const SEMANTIC_SEARCH_POOL_LIMIT = 40;

export function tasksForAiContext(tasks: RecallTask[]) {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    priority: t.priority,
    time: t.time ?? null,
    tags: t.tags,
  }));
}

export function notesForAiContext(notes: RecallNote[], limit = AI_NOTES_CONTEXT_LIMIT) {
  return notes.slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title,
    preview: n.preview,
    tags: n.tags,
  }));
}

export function noteMatchesQuery(note: RecallNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const hay = `${note.title}\n${note.preview}\n${note.content}\n${note.tags.join(" ")}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

export function filterNotesByQuery(notes: RecallNote[], query: string): RecallNote[] {
  const q = query.trim();
  if (!q) return notes;
  return notes.filter((n) => noteMatchesQuery(n, q));
}

export function filterNotesByNotebook(
  notes: RecallNote[],
  activeNotebook: NotebookFilter,
): RecallNote[] {
  if (activeNotebook === "all") return notes;
  if (activeNotebook === "unfiled") return notes.filter((n) => !n.notebookId);
  return notes.filter((n) => n.notebookId === activeNotebook);
}

/** Pick a small, relevant note set for AI — search results first, then notebook scope. */
export function resolveNotesForAi(opts: {
  notes: RecallNote[];
  searchQuery?: string;
  activeNotebook?: NotebookFilter;
  activeNote?: RecallNote | null;
  limit?: number;
}) {
  const limit = opts.limit ?? AI_NOTES_CONTEXT_LIMIT;
  let pool = filterNotesByNotebook(opts.notes, opts.activeNotebook ?? "all");

  const q = opts.searchQuery?.trim();
  if (q) {
    pool = filterNotesByQuery(pool, q);
  }

  const capped = notesForAiContext(pool, limit);
  const active = opts.activeNote;

  if (active && !capped.some((n) => n.id === active.id)) {
    const activeEntry = {
      id: active.id,
      title: active.title,
      preview: (active.content || active.preview).slice(0, 800),
      tags: active.tags,
    };
    return [activeEntry, ...capped.slice(0, Math.max(0, limit - 1))];
  }

  if (active) {
    return capped.map((n) =>
      n.id === active.id
        ? {
            ...n,
            preview: (active.content || active.preview).slice(0, 800),
          }
        : n,
    );
  }

  return capped;
}

export function notesForSemanticSearch(notes: RecallNote[], limit = SEMANTIC_SEARCH_POOL_LIMIT) {
  return notes.slice(0, limit).map((n) => ({
    id: n.id,
    title: n.title,
    text: `${n.title}\n${n.preview}\n${n.content}`.slice(0, 600),
  }));
}
