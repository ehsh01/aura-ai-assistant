import {
  filterNotesByNotebook,
  type NotebookFilter,
  type RecallNote,
} from "./recall-context";

export function notesForList(input: {
  loadedNotes: RecallNote[];
  serverResults: RecallNote[] | null;
  query: string;
  notebook: NotebookFilter;
  tag: string;
}): RecallNote[] {
  const base = input.query.trim()
    ? (input.serverResults ?? [])
    : input.loadedNotes;
  return filterNotesByNotebook(base, input.notebook).filter(
    (note) => input.tag === "All" || note.tags.includes(input.tag),
  );
}
