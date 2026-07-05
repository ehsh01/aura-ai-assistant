export function previewFromContent(content: string): string {
  const line = content.trim().split("\n").find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function noteDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function newNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newCaptureId(): string {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
