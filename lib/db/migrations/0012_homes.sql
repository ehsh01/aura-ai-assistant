-- Home properties + allow warranty subjectId to point at vehicle OR home.
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "homes" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "address_line1" varchar(255),
  "address_line2" varchar(255),
  "city" varchar(128),
  "region" varchar(64),
  "postal_code" varchar(32),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "homes_user_id_idx" ON "homes" ("user_id");
CREATE INDEX IF NOT EXISTS "homes_display_name_idx" ON "homes" ("display_name");

-- Drop vehicle-only FK so subject_id can reference homes (or stay opaque).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.warranties'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%subject_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.warranties DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

COMMIT;
