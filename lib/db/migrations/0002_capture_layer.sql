-- Recall Capture Layer migration (additive, idempotent)
-- Adds: captures table (raw, immutable Capture Layer / Raw Capture Repository).
-- Safe to run multiple times. Does not alter existing tables.
--
-- Rationale: docs/01_Architecture.md (2.1 Capture First, Interpret Later) and
-- docs/03_Data_Model.md (3.1 Capture) require raw input to be stored before any
-- AI processing and never overwritten. This is distinct from `capture_items`,
-- which holds derived AI/heuristic suggestions.

BEGIN;

CREATE TABLE IF NOT EXISTS "captures" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_type" varchar(32) NOT NULL DEFAULT 'manual',
  "source_name" varchar(255),
  "source_url" text,
  "title" varchar(500),
  "raw_text" text NOT NULL,
  "raw_html" text,
  "raw_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "processed_status" varchar(16) NOT NULL DEFAULT 'pending',
  "processing_error" text,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "captures_user_id_idx" ON "captures" ("user_id");
CREATE INDEX IF NOT EXISTS "captures_user_status_idx" ON "captures" ("user_id", "processed_status");
CREATE INDEX IF NOT EXISTS "captures_user_captured_at_idx" ON "captures" ("user_id", "captured_at");

COMMIT;
