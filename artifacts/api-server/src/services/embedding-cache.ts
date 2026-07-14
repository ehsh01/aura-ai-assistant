import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { entityEmbeddings } from "@workspace/db/schema";
import { getDb, isDatabaseConfigured } from "../lib/db";
import { newEmbeddingId } from "../lib/recall-format";
import { aiService } from "./ai";

type CacheEntry = {
  hash: string;
  vector: number[];
  updatedAt: number;
};

/** L1: in-process embedding cache. Survives for the PM2 process lifetime. */
const cache = new Map<string, CacheEntry>();

const MAX_ENTRIES = 8_000;
const PGVECTOR_DIMS = 1536;

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function cacheKey(userId: string, entityType: string, entityId: string): string {
  return `${userId}:${entityType}:${entityId}`;
}

function embeddingModel(): string {
  return (
    aiService.getStatus().embeddingModel?.trim() ||
    process.env.OPENAI_EMBEDDING_MODEL?.trim() ||
    "text-embedding-3-small"
  );
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
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

type Pending = { item: EmbeddableItem; hash: string; key: string };

function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}

async function syncPgvectorColumn(
  userId: string,
  model: string,
  entityType: string,
  entityId: string,
  vector: number[],
): Promise<void> {
  if (vector.length !== PGVECTOR_DIMS) return;
  try {
    await getDb().execute(sql`
      UPDATE entity_embeddings
      SET embedding = ${toPgVectorLiteral(vector)}::vector
      WHERE user_id = ${userId}::uuid
        AND entity_type = ${entityType}
        AND entity_id = ${entityId}
        AND model = ${model}
    `);
  } catch {
    // Extension/column may be missing on older DBs — jsonb path still works.
  }
}

async function loadFromDb(
  userId: string,
  model: string,
  pending: Pending[],
): Promise<void> {
  if (!isDatabaseConfigured() || pending.length === 0) return;
  try {
    const db = getDb();
    const entityIds = [...new Set(pending.map((p) => p.item.entityId))];
    const rows = await db
      .select()
      .from(entityEmbeddings)
      .where(
        and(
          eq(entityEmbeddings.userId, userId),
          eq(entityEmbeddings.model, model),
          inArray(entityEmbeddings.entityId, entityIds),
        ),
      );

    const byKey = new Map(
      rows.map((r) => [`${r.entityType}:${r.entityId}`, r] as const),
    );

    for (const p of pending) {
      const row = byKey.get(`${p.item.entityType}:${p.item.entityId}`);
      if (!row || row.contentHash !== p.hash) continue;
      if (!Array.isArray(row.vector) || row.vector.length === 0) continue;
      cache.set(p.key, {
        hash: p.hash,
        vector: row.vector,
        updatedAt: Date.now(),
      });
    }
  } catch {
    // DB miss is non-fatal — fall through to OpenAI.
  }
}

async function persistToDb(
  userId: string,
  model: string,
  rows: { item: EmbeddableItem; hash: string; vector: number[] }[],
): Promise<void> {
  if (!isDatabaseConfigured() || rows.length === 0) return;
  try {
    const db = getDb();
    const now = new Date();
    for (const row of rows) {
      await db
        .insert(entityEmbeddings)
        .values({
          id: newEmbeddingId(),
          userId,
          entityType: row.item.entityType,
          entityId: row.item.entityId,
          contentHash: row.hash,
          model,
          dims: row.vector.length,
          vector: row.vector,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            entityEmbeddings.userId,
            entityEmbeddings.entityType,
            entityEmbeddings.entityId,
            entityEmbeddings.model,
          ],
          set: {
            contentHash: row.hash,
            dims: row.vector.length,
            vector: row.vector,
            updatedAt: now,
          },
        });
      await syncPgvectorColumn(
        userId,
        model,
        row.item.entityType,
        row.item.entityId,
        row.vector,
      );
    }
  } catch {
    // Persistence failure must not break Ask.
  }
}

/**
 * Rank entity ids by cosine distance via pgvector when available.
 * Returns null if extension/column missing so callers keep JS cosine.
 */
export async function rankEntitiesByPgvector(opts: {
  userId: string;
  model?: string;
  query: number[];
  entityTypes?: string[];
  limit?: number;
}): Promise<Array<{ entityType: string; entityId: string; distance: number }> | null> {
  if (!isDatabaseConfigured() || opts.query.length !== PGVECTOR_DIMS) return null;
  const model = opts.model ?? embeddingModel();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  try {
    const typeFilter =
      opts.entityTypes && opts.entityTypes.length > 0
        ? sql`AND entity_type = ANY(${opts.entityTypes})`
        : sql``;
    const result = await getDb().execute(sql`
      SELECT entity_type, entity_id,
             (embedding <=> ${toPgVectorLiteral(opts.query)}::vector) AS distance
      FROM entity_embeddings
      WHERE user_id = ${opts.userId}::uuid
        AND model = ${model}
        AND embedding IS NOT NULL
        ${typeFilter}
      ORDER BY embedding <=> ${toPgVectorLiteral(opts.query)}::vector
      LIMIT ${limit}
    `);
    const rawRows =
      (result as { rows?: Record<string, unknown>[] }).rows ??
      (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
    return rawRows.map((r) => ({
      entityType: String(r.entity_type ?? r.entityType),
      entityId: String(r.entity_id ?? r.entityId),
      distance: Number(r.distance ?? 1),
    }));
  } catch {
    return null;
  }
}

export async function embedItemsCached(
  userId: string,
  items: EmbeddableItem[],
): Promise<Map<string, number[]> | null> {
  if (aiService.getStatus().degraded || items.length === 0) return null;
  if (typeof aiService.embedTexts !== "function") return null;

  const model = embeddingModel();
  let pending: Pending[] = [];
  const vectors = new Map<string, number[]>();

  for (const item of items) {
    const key = cacheKey(userId, item.entityType, item.entityId);
    const hash = contentHash(item.text);
    const hit = cache.get(key);
    if (hit && hit.hash === hash) {
      vectors.set(`${item.entityType}:${item.entityId}`, hit.vector);
      hit.updatedAt = Date.now();
    } else {
      pending.push({ item, hash, key });
    }
  }

  if (pending.length > 0) {
    await loadFromDb(userId, model, pending);
    const stillMissing: Pending[] = [];
    for (const p of pending) {
      const hit = cache.get(p.key);
      if (hit && hit.hash === p.hash) {
        vectors.set(`${p.item.entityType}:${p.item.entityId}`, hit.vector);
        hit.updatedAt = Date.now();
      } else {
        stillMissing.push(p);
      }
    }
    pending = stillMissing;
  }

  if (pending.length > 0) {
    const CHUNK = 64;
    const toPersist: { item: EmbeddableItem; hash: string; vector: number[] }[] = [];
    for (let i = 0; i < pending.length; i += CHUNK) {
      const slice = pending.slice(i, i + CHUNK);
      const embeds = await aiService.embedTexts!(
        slice.map((m) => m.item.text.slice(0, 2_000)),
      );
      for (let j = 0; j < slice.length; j++) {
        const row = slice[j]!;
        const vector = embeds[j];
        if (!vector) continue;
        cache.set(row.key, { hash: row.hash, vector, updatedAt: Date.now() });
        vectors.set(`${row.item.entityType}:${row.item.entityId}`, vector);
        toPersist.push({ item: row.item, hash: row.hash, vector });
      }
    }
    evictIfNeeded();
    void persistToDb(userId, model, toPersist);
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (aiService.getStatus().degraded) return null;
  if (typeof aiService.embedTexts !== "function") return null;
  const [vec] = await aiService.embedTexts([text.slice(0, 2_000)]);
  return vec ?? null;
}

export function warmEntityEmbedding(
  userId: string,
  item: EmbeddableItem,
): void {
  void embedItemsCached(userId, [item]).catch(() => {
    // Warming is best-effort; Ask still works without it.
  });
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
