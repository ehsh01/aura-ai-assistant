import type { RecallNote, RecallTask } from "./recall-context";

export interface UserRecallData {
  notes: RecallNote[];
  tasks: RecallTask[];
}

const STORAGE_VERSION = 1;

function storageKey(userId: string): string {
  return `recall_user_data_v${STORAGE_VERSION}_${userId}`;
}

export function loadUserData(userId: string): UserRecallData {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { notes: [], tasks: [] };
    const parsed = JSON.parse(raw) as UserRecallData;
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch {
    return { notes: [], tasks: [] };
  }
}

export function saveUserData(userId: string, data: UserRecallData): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(data));
}

export function clearUserData(userId: string): void {
  localStorage.removeItem(storageKey(userId));
}

export function noteDateLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function previewFromContent(content: string): string {
  const line = content.trim().split("\n").find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
