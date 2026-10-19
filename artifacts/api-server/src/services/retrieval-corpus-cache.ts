const DEFAULT_TTL_MS = 45_000;
const MAX_ENTRIES = 24;
const MAX_BYTES = 3 * 1024 * 1024;

// Process-local by design: writes in another PM2 process cannot evict this map,
// so cross-process staleness is bounded by DEFAULT_TTL_MS.
export type RetrievalCorpusCacheMode = "slim-link" | "full";

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneForCacheBoundary<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      isPlainRecord(entry) ? { ...entry } : entry,
    ) as T;
  }
  if (!isPlainRecord(value)) return value;
  const clone: Record<string, unknown> = { ...value };
  for (const [field, entry] of Object.entries(clone)) {
    if (!Array.isArray(entry)) continue;
    clone[field] = entry.map((item) =>
      isPlainRecord(item) ? { ...item } : item,
    );
  }
  return clone as T;
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
  return cloneForCacheBoundary(entry.value as T);
}

export function setRetrievalCorpusCache<T>(
  userId: string,
  mode: RetrievalCorpusCacheMode,
  value: T,
): void {
  if (!enabled()) return;
  pruneExpired();
  const storedValue = cloneForCacheBoundary(value);
  const bytes = estimatedBytes(storedValue);
  const cacheKey = key(userId, mode);
  remove(cacheKey);
  if (bytes > MAX_BYTES) return;

  entries.set(cacheKey, {
    userId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
    bytes,
    // Retrieval inputs remain pre-redaction. Provider/TTS input and answer
    // output boundaries must redact afresh on every request, including hits.
    value: storedValue,
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
