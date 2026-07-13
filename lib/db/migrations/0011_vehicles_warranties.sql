-- Structured vehicles + warranties for Phase 4 domain expansion.
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "year" varchar(16),
  "make" varchar(128),
  "model" varchar(128),
  "vin" varchar(64),
  "license_plate" varchar(32),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "vehicles_user_id_idx" ON "vehicles" ("user_id");
CREATE INDEX IF NOT EXISTS "vehicles_vin_idx" ON "vehicles" ("vin");
CREATE INDEX IF NOT EXISTS "vehicles_display_name_idx" ON "vehicles" ("display_name");

CREATE TABLE IF NOT EXISTS "warranties" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(500) NOT NULL,
  "subject_type" varchar(32) NOT NULL DEFAULT 'other',
  "subject_id" varchar(64) REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "provider" varchar(255),
  "expires_at" varchar(10),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "warranties_user_id_idx" ON "warranties" ("user_id");
CREATE INDEX IF NOT EXISTS "warranties_expires_at_idx" ON "warranties" ("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "warranties_subject_idx"
  ON "warranties" ("user_id", "subject_type", "subject_id");

COMMIT;
