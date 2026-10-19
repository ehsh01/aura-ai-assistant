const DEFAULT_TTL_MS = 45_000;
const MAX_ENTRIES = 24;
const MAX_BYTES = 3 * 1024 * 1024;

export type RetrievalCorpusCacheMode = "standard" | "email";

type CacheEntry = {
  userId: string;
  expiresAt: number;
  bytes: number;
  value: unknown;
};

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function enabled(): boolean {
  return (
    process.env.RECALL_RETRIEVAL_CORPUS_CACHE_ENABLED?.trim().toLowerCase() !==
    "false"
  );
}

function key(userId: string, mode: RetrievalCorpusCacheMode): string {
  return `${userId}:${mode}`;
}

function remove(cacheKey: string): void {
  const entry = entries.get(cacheKey);
  if (!entry) return;
  totalBytes -= entry.bytes;
  entries.delete(cacheKey);
}

function pruneExpired(now = Date.now()): void {
  for (const [cacheKey, entry] of entries) {
    if (entry.expiresAt <= now) remove(cacheKey);
  }
}

function estimatedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return MAX_BYTES + 1;
  }
}

export function getRetrievalCorpusCache<T>(
  userId: string,
  mode: RetrievalCorpusCacheMode,
): T | null {
  if (!enabled()) return null;
  const now = Date.now();
  pruneExpired(now);
  const cacheKey = key(userId, mode);
  const entry = entries.get(cacheKey);
  if (!entry) return null;
  // Refresh insertion order so eviction is least-recently-used.
  entries.delete(cacheKey);
  entries.set(cacheKey, entry);
  return entry.value as T;
}

export function setRetrievalCorpusCache<T>(
  userId: string,
  mode: RetrievalCorpusCacheMode,
  value: T,
): void {
  if (!enabled()) return;
  pruneExpired();
  const bytes = estimatedBytes(value);
  const cacheKey = key(userId, mode);
  remove(cacheKey);
  if (bytes > MAX_BYTES) return;

  entries.set(cacheKey, {
    userId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
    bytes,
    // Retrieval inputs remain pre-redaction. Provider/TTS input and answer
    // output boundaries must redact afresh on every request, including hits.
    value,
  });
  totalBytes += bytes;

  while (entries.size > MAX_ENTRIES || totalBytes > MAX_BYTES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    remove(oldest);
  }
}

export function invalidateRetrievalCorpusCache(userId: string): void {
  for (const [cacheKey, entry] of entries) {
    if (entry.userId === userId) remove(cacheKey);
  }
}

/** @internal test helper */
export function resetRetrievalCorpusCacheForTests(): void {
  entries.clear();
  totalBytes = 0;
}

/** @internal test helper */
export function retrievalCorpusCacheStatsForTests(): {
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  ttlMs: number;
} {
  pruneExpired();
  return {
    entries: entries.size,
    bytes: totalBytes,
    maxEntries: MAX_ENTRIES,
    maxBytes: MAX_BYTES,
    ttlMs: DEFAULT_TTL_MS,
  };
}
