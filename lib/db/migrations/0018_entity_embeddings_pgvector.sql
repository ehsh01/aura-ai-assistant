-- pgvector dual-write column for entity embeddings.
-- Keeps jsonb `vector` for fallback; adds typed `embedding` for ANN-ready distance.
-- Additive + idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "entity_embeddings"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Backfill from existing jsonb arrays (text-embedding-3-small = 1536 dims).
UPDATE "entity_embeddings" e
SET "embedding" = sub.vec
FROM (
  SELECT
    id,
    (
      SELECT array_agg(x::float8 ORDER BY ord)::vector(1536)
      FROM jsonb_array_elements_text(vector) WITH ORDINALITY AS t(x, ord)
    ) AS vec
  FROM "entity_embeddings"
  WHERE embedding IS NULL
    AND dims = 1536
    AND jsonb_typeof(vector) = 'array'
    AND jsonb_array_length(vector) = 1536
) AS sub
WHERE e.id = sub.id
  AND sub.vec IS NOT NULL;

-- HNSW cosine index (partial: only rows with embedding filled).
CREATE INDEX IF NOT EXISTS "entity_embeddings_embedding_hnsw"
  ON "entity_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

COMMIT;
