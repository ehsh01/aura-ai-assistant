export function notesPath(opts?: {
  noteId?: string;
  pinned?: boolean;
  newNote?: boolean;
  notebook?: "all" | "unfiled" | string;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (opts?.noteId) params.set("note", opts.noteId);
  if (opts?.pinned) params.set("pinned", "1");
  if (opts?.newNote) params.set("new", "1");
  if (opts?.notebook && opts.notebook !== "all") params.set("notebook", opts.notebook);
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  const q = params.toString();
  return q ? `/notes?${q}` : "/notes";
}

export function tasksPath(opts?: { taskId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.taskId) params.set("task", opts.taskId);
  const q = params.toString();
  return q ? `/tasks?${q}` : "/tasks";
}

export function inboxPath(): string {
  return "/inbox";
}

export function projectsPath(projectId?: string): string {
  return projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects";
}

export function readSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}
