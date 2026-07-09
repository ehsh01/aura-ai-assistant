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

export function tasksPath(opts?: { taskId?: string; personId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.taskId) params.set("task", opts.taskId);
  if (opts?.personId) params.set("person", opts.personId);
  const q = params.toString();
  return q ? `/tasks?${q}` : "/tasks";
}

export function inboxPath(): string {
  return "/inbox";
}

export function projectsPath(projectId?: string): string {
  return projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects";
}

export function peoplePath(opts?: { personId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.personId) params.set("person", opts.personId);
  const q = params.toString();
  return q ? `/people?${q}` : "/people";
}

export function askPath(opts?: { q?: string }): string {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  const q = params.toString();
  return q ? `/ask?${q}` : "/ask";
}

export function documentsPath(opts?: { documentId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.documentId) params.set("doc", opts.documentId);
  const q = params.toString();
  return q ? `/documents?${q}` : "/documents";
}

export function knowledgePath(opts?: { knowledgeId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.knowledgeId) params.set("item", opts.knowledgeId);
  const q = params.toString();
  return q ? `/knowledge?${q}` : "/knowledge";
}

/** Best-effort deep link for Ask related records / evidence entities. */
export function entityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "task":
      return tasksPath({ taskId: entityId });
    case "note":
      return notesPath({ noteId: entityId });
    case "person":
      return peoplePath({ personId: entityId });
    case "document":
      return documentsPath({ documentId: entityId });
    case "knowledge":
      return knowledgePath({ knowledgeId: entityId });
    case "capture":
    case "capture_item":
      return inboxPath();
    case "project":
      return projectsPath(entityId);
    default:
      return null;
  }
}

export function readSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}
