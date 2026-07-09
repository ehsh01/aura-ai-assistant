import { createHash } from "node:crypto";
import { aiService } from "./ai";

type CacheEntry = {
  hash: string;
  vector: number[];
  updatedAt: number;
};

/** In-process embedding cache keyed by entity id. Survives for the PM2 process lifetime. */
const cache = new Map<string, CacheEntry>();

const MAX_ENTRIES = 8_000;

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function cacheKey(userId: string, entityType: string, entityId: string): string {
  return `${userId}:${entityType}:${entityId}`;
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Drop oldest ~10%.
  const entries = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const drop = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < drop; i++) {
    const key = entries[i]?.[0];
    if (key) cache.delete(key);
  }
}

export type EmbeddableItem = {
  entityType: string;
  entityId: string;
  text: string;
};

/**
 * Return embeddings for items, reusing cached vectors when content hasn't changed.
 * Falls back to null when AI embeddings are unavailable (caller should use keyword rank).
 */
export async function embedItemsCached(
  userId: string,
  items: EmbeddableItem[],
): Promise<Map<string, number[]> | null> {
  if (aiService.getStatus().degraded || items.length === 0) return null;
  if (typeof aiService.embedTexts !== "function") return null;

  const missing: { item: EmbeddableItem; hash: string; key: string }[] = [];
  const vectors = new Map<string, number[]>();

  for (const item of items) {
    const key = cacheKey(userId, item.entityType, item.entityId);
    const hash = contentHash(item.text);
    const hit = cache.get(key);
    if (hit && hit.hash === hash) {
      vectors.set(`${item.entityType}:${item.entityId}`, hit.vector);
      hit.updatedAt = Date.now();
    } else {
      missing.push({ item, hash, key });
    }
  }

  if (missing.length > 0) {
    // Batch in chunks to stay within embedding API limits.
    const CHUNK = 64;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const slice = missing.slice(i, i + CHUNK);
      const embeds = await aiService.embedTexts!(
        slice.map((m) => m.item.text.slice(0, 2_000)),
      );
      for (let j = 0; j < slice.length; j++) {
        const row = slice[j]!;
        const vector = embeds[j];
        if (!vector) continue;
        cache.set(row.key, { hash: row.hash, vector, updatedAt: Date.now() });
        vectors.set(`${row.item.entityType}:${row.item.entityId}`, vector);
      }
    }
    evictIfNeeded();
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (aiService.getStatus().degraded) return null;
  if (typeof aiService.embedTexts !== "function") return null;
  const [vec] = await aiService.embedTexts([text.slice(0, 2_000)]);
  return vec ?? null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Test helper */
export function clearEmbeddingCacheForTests(): void {
  cache.clear();
}
