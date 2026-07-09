-- Persistent embeddings for hybrid Ask retrieval (additive, idempotent).
-- jsonb vectors keep us off pgvector until corpus size needs ANN.

BEGIN;

CREATE TABLE IF NOT EXISTS "entity_embeddings" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar(64) NOT NULL,
  "content_hash" varchar(32) NOT NULL,
  "model" varchar(64) NOT NULL,
  "dims" integer NOT NULL,
  "vector" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "entity_embeddings_user_entity_model_uidx"
  ON "entity_embeddings" ("user_id", "entity_type", "entity_id", "model");
CREATE INDEX IF NOT EXISTS "entity_embeddings_user_id_idx"
  ON "entity_embeddings" ("user_id");
CREATE INDEX IF NOT EXISTS "entity_embeddings_entity_idx"
  ON "entity_embeddings" ("entity_type", "entity_id");

COMMIT;
