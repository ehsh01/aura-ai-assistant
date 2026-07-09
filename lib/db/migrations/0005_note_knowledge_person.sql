-- Link notes and knowledge items to people (mirrors tasks.requester_person_id).
-- Additive + idempotent. Backfills from existing person:DisplayName tags.

BEGIN;

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "primary_person_id" varchar(64);
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "primary_person_id" varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notes_primary_person_id_people_id_fk'
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_primary_person_id_people_id_fk"
      FOREIGN KEY ("primary_person_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'knowledge_items_primary_person_id_people_id_fk'
  ) THEN
    ALTER TABLE "knowledge_items"
      ADD CONSTRAINT "knowledge_items_primary_person_id_people_id_fk"
      FOREIGN KEY ("primary_person_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "notes_primary_person_id_idx" ON "notes" ("primary_person_id");
CREATE INDEX IF NOT EXISTS "knowledge_items_primary_person_id_idx" ON "knowledge_items" ("primary_person_id");

-- Backfill notes from person: tags (first matching person for that user).
UPDATE "notes" n
SET "primary_person_id" = p.id
FROM "people" p
WHERE n.primary_person_id IS NULL
  AND n.user_id = p.user_id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(n.tags, '[]'::jsonb)) AS t(tag)
    WHERE lower(t.tag) = lower('person:' || p.display_name)
  );

-- Backfill knowledge the same way.
UPDATE "knowledge_items" k
SET "primary_person_id" = p.id
FROM "people" p
WHERE k.primary_person_id IS NULL
  AND k.user_id = p.user_id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(k.tags, '[]'::jsonb)) AS t(tag)
    WHERE lower(t.tag) = lower('person:' || p.display_name)
  );

COMMIT;
