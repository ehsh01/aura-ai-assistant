import { ingestCapture } from "@/lib/recall-api";

const QUEUE_KEY = "recall_capture_queue_v1";

export type QueuedCapture = {
  id: string;
  rawText: string;
  sourceType?: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  createdAt: string;
  attempts: number;
};

function readQueue(): QueuedCapture[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedCapture[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedCapture[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function newId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getQueuedCaptureCount(): number {
  return readQueue().length;
}

export function enqueueCapture(input: {
  rawText: string;
  sourceType?: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
}): QueuedCapture {
  const item: QueuedCapture = {
    id: newId(),
    rawText: input.rawText,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    title: input.title,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
  return item;
}

/**
 * Ingest immediately when online; otherwise queue for later.
 * Also queues on network/API failure so phone dumps aren't lost.
 */
export async function ingestCaptureReliable(input: {
  rawText: string;
  sourceType?: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
}): Promise<{ queued: boolean; id?: string; jobId?: string }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueueCapture(input);
    return { queued: true };
  }

  try {
    const res = await ingestCapture(input);
    return { queued: false, id: res.id, jobId: res.jobId };
  } catch {
    enqueueCapture(input);
    return { queued: true };
  }
}

let flushing = false;

/** Flush queued captures. Safe to call often; concurrent calls coalesce. */
export async function flushCaptureQueue(): Promise<{ sent: number; remaining: number }> {
  if (flushing) return { sent: 0, remaining: getQueuedCaptureCount() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: 0, remaining: getQueuedCaptureCount() };
  }

  flushing = true;
  let sent = 0;
  try {
    let queue = readQueue();
    const keep: QueuedCapture[] = [];
    for (const item of queue) {
      try {
        await ingestCapture({
          rawText: item.rawText,
          sourceType: item.sourceType,
          sourceName: item.sourceName,
          sourceUrl: item.sourceUrl,
          title: item.title,
        });
        sent += 1;
      } catch {
        keep.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    writeQueue(keep);
    return { sent, remaining: keep.length };
  } finally {
    flushing = false;
  }
}

/** Start listening for online events. Call once from app boot. */
export function startCaptureQueueSync(
  onFlush?: (result: { sent: number; remaining: number }) => void,
): () => void {
  const run = () => {
    void flushCaptureQueue().then((result) => {
      if (result.sent > 0) onFlush?.(result);
    });
  };
  window.addEventListener("online", run);
  // Attempt once on boot in case items were left from a previous session.
  run();
  return () => window.removeEventListener("online", run);
}
