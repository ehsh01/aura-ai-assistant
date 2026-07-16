const STORAGE_KEY = "recall_waiting_dismissed_v1";

function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage may be unavailable.
  }
}

export function getDismissedWaitingIds(): Set<string> {
  return readIds();
}

export function rememberDismissedWaitingId(waitingItemId: string): void {
  const id = waitingItemId.trim();
  if (!id) return;
  const ids = readIds();
  ids.add(id);
  // Legacy bare note ids.
  if (id.startsWith("note:")) ids.add(id.slice("note:".length));
  writeIds(ids);
}

export function isWaitingDismissed(
  waitingItemId: string,
  dismissed: Set<string> = readIds(),
): boolean {
  const id = waitingItemId.trim();
  if (!id) return false;
  if (dismissed.has(id)) return true;
  if (id.startsWith("note:") && dismissed.has(id.slice("note:".length))) return true;
  if (!id.includes(":") && dismissed.has(`note:${id}`)) return true;
  return false;
}

export function filterDismissedWaiting<T extends { id: string }>(items: T[]): T[] {
  const dismissed = readIds();
  if (dismissed.size === 0) return items;
  return items.filter((item) => !isWaitingDismissed(item.id, dismissed));
}
