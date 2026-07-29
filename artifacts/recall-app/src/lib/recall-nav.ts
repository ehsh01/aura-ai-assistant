export function notesPath(opts?: {
  noteId?: string;
  pinned?: boolean;
  newNote?: boolean;
  notebook?: "all" | "unfiled" | string;
  q?: string;
  /** Filter notes tagged person:Name (display name). */
  person?: string;
}): string {
  const params = new URLSearchParams();
  if (opts?.noteId) params.set("note", opts.noteId);
  if (opts?.pinned) params.set("pinned", "1");
  if (opts?.newNote) params.set("new", "1");
  if (opts?.notebook && opts.notebook !== "all") params.set("notebook", opts.notebook);
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.person?.trim()) params.set("person", opts.person.trim());
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

export function homePath(opts?: { capture?: string }): string {
  const params = new URLSearchParams();
  if (opts?.capture?.trim()) params.set("capture", opts.capture.trim());
  const q = params.toString();
  // Captures land on Today with the pending text; bare home is Today itself.
  if (q) return `/today?${q}`;
  return "/";
}

export function todayPath(opts?: { capture?: string }): string {
  const params = new URLSearchParams();
  if (opts?.capture?.trim()) params.set("capture", opts.capture.trim());
  const q = params.toString();
  return q ? `/today?${q}` : "/today";
}

export function inboxPath(opts?: { captureId?: string }): string {
  const params = new URLSearchParams();
  if (opts?.captureId) params.set("capture", opts.captureId);
  const q = params.toString();
  return q ? `/inbox?${q}` : "/inbox";
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

export function vehiclesPath(opts?: {
  vehicleId?: string;
  homeId?: string;
  warrantyId?: string;
}): string {
  const params = new URLSearchParams();
  if (opts?.vehicleId) params.set("vehicle", opts.vehicleId);
  if (opts?.homeId) params.set("home", opts.homeId);
  if (opts?.warrantyId) params.set("warranty", opts.warrantyId);
  const q = params.toString();
  return q ? `/vehicles?${q}` : "/vehicles";
}

export function organizationsPath(opts?: {
  organizationId?: string;
  invoiceId?: string;
}): string {
  const params = new URLSearchParams();
  if (opts?.organizationId) params.set("org", opts.organizationId);
  if (opts?.invoiceId) params.set("invoice", opts.invoiceId);
  const q = params.toString();
  return q ? `/organizations?${q}` : "/organizations";
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

export function memoryPath(opts?: { memoryId?: string; domain?: string }): string {
  const params = new URLSearchParams();
  if (opts?.memoryId) params.set("memory", opts.memoryId);
  if (opts?.domain?.trim()) params.set("domain", opts.domain.trim());
  const q = params.toString();
  return q ? `/memory?${q}` : "/memory";
}

/** Best-effort deep link for Ask related records / evidence entities. */
export function entityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "task":
      return tasksPath({ taskId: entityId });
    case "note":
      return notesPath({ noteId: entityId });
    case "person":
      return `/people/${encodeURIComponent(entityId)}`;
    case "document":
      return documentsPath({ documentId: entityId });
    case "knowledge":
      // Knowledge items are migrated into notes (same id) — Sidebar consolidation.
      return notesPath({ noteId: entityId });
    case "memory":
      return memoryPath({ memoryId: entityId });
    case "vehicle":
      return vehiclesPath({ vehicleId: entityId });
    case "home":
      return vehiclesPath({ homeId: entityId });
    case "warranty":
      return vehiclesPath({ warrantyId: entityId });
    case "organization":
      return organizationsPath({ organizationId: entityId });
    case "invoice":
      return organizationsPath({ invoiceId: entityId });
    case "capture":
    case "capture_item":
      return inboxPath({ captureId: entityId });
    case "project":
      return projectsPath(entityId);
    case "waiting_item":
      return `/waiting/${encodeURIComponent(entityId)}`;
    case "attention_item":
      return `/deadlines?item=${encodeURIComponent(entityId)}`;
    default:
      return null;
  }
}

export function readSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}
