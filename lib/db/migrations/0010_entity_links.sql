-- Typed entity relationships for connected-object retrieval.
-- Additive + idempotent. Backfills primary-person FKs from notes/knowledge/memories/tasks.

BEGIN;

CREATE TABLE IF NOT EXISTS "entity_links" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_entity_type" varchar(32) NOT NULL,
  "from_entity_id" varchar(64) NOT NULL,
  "to_entity_type" varchar(32) NOT NULL,
  "to_entity_id" varchar(64) NOT NULL,
  "link_type" varchar(64) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "entity_links_unique_idx"
  ON "entity_links" (
    "user_id",
    "from_entity_type",
    "from_entity_id",
    "to_entity_type",
    "to_entity_id",
    "link_type"
  );

CREATE INDEX IF NOT EXISTS "entity_links_from_idx"
  ON "entity_links" ("user_id", "from_entity_type", "from_entity_id");

CREATE INDEX IF NOT EXISTS "entity_links_to_idx"
  ON "entity_links" ("user_id", "to_entity_type", "to_entity_id");

-- Backfill primary_person links from existing FKs (stable ids so re-runs are no-ops).
INSERT INTO "entity_links" (
  "id", "user_id", "from_entity_type", "from_entity_id",
  "to_entity_type", "to_entity_id", "link_type", "metadata", "created_at", "updated_at"
)
SELECT
  'elink-note-' || n.id,
  n.user_id,
  'note',
  n.id,
  'person',
  n.primary_person_id,
  'primary_person',
  '{}'::jsonb,
  COALESCE(n.created_at, now()),
  now()
FROM "notes" n
WHERE n.primary_person_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "entity_links" (
  "id", "user_id", "from_entity_type", "from_entity_id",
  "to_entity_type", "to_entity_id", "link_type", "metadata", "created_at", "updated_at"
)
SELECT
  'elink-knowledge-' || k.id,
  k.user_id,
  'knowledge',
  k.id,
  'person',
  k.primary_person_id,
  'primary_person',
  '{}'::jsonb,
  COALESCE(k.created_at, now()),
  now()
FROM "knowledge_items" k
WHERE k.primary_person_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "entity_links" (
  "id", "user_id", "from_entity_type", "from_entity_id",
  "to_entity_type", "to_entity_id", "link_type", "metadata", "created_at", "updated_at"
)
SELECT
  'elink-memory-' || m.id,
  m.user_id,
  'memory',
  m.id,
  'person',
  m.primary_person_id,
  'primary_person',
  '{}'::jsonb,
  COALESCE(m.created_at, now()),
  now()
FROM "life_memories" m
WHERE m.primary_person_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "entity_links" (
  "id", "user_id", "from_entity_type", "from_entity_id",
  "to_entity_type", "to_entity_id", "link_type", "metadata", "created_at", "updated_at"
)
SELECT
  'elink-task-' || t.id,
  t.user_id,
  'task',
  t.id,
  'person',
  t.requester_person_id,
  'primary_person',
  '{}'::jsonb,
  COALESCE(t.created_at, now()),
  now()
FROM "tasks" t
WHERE t.requester_person_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
