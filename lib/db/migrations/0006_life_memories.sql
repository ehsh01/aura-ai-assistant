-- Permanent life memories (forever facts) with life-domain taxonomy.
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "life_memories" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "domain" varchar(32) NOT NULL DEFAULT 'other',
  "title" varchar(500) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "primary_person_id" varchar(64) REFERENCES "people"("id") ON DELETE SET NULL,
  "project_id" varchar(64) REFERENCES "projects"("id") ON DELETE SET NULL,
  "source_type" varchar(16) NOT NULL DEFAULT 'teach',
  "source_id" varchar(64),
  "pinned" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "life_memories_user_id_idx" ON "life_memories" ("user_id");
CREATE INDEX IF NOT EXISTS "life_memories_user_domain_idx" ON "life_memories" ("user_id", "domain");
CREATE INDEX IF NOT EXISTS "life_memories_primary_person_id_idx" ON "life_memories" ("primary_person_id");

COMMIT;
