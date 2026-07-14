-- Life Memory lifecycle: active / superseded / expired / archived.
-- Additive + idempotent. Existing rows default to active.

BEGIN;

ALTER TABLE "life_memories"
  ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'active';

ALTER TABLE "life_memories"
  ADD COLUMN IF NOT EXISTS "supersedes_id" varchar(64);

ALTER TABLE "life_memories"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'life_memories_supersedes_id_fkey'
  ) THEN
    ALTER TABLE "life_memories"
      ADD CONSTRAINT "life_memories_supersedes_id_fkey"
      FOREIGN KEY ("supersedes_id") REFERENCES "life_memories"("id") ON DELETE SET NULL;
  END IF;
END $$;

UPDATE "life_memories"
SET "status" = 'active'
WHERE "status" IS NULL OR "status" = '';

CREATE INDEX IF NOT EXISTS "life_memories_user_status_idx"
  ON "life_memories" ("user_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "life_memories_user_active_idx"
  ON "life_memories" ("user_id", "updated_at")
  WHERE "status" = 'active';

COMMIT;
