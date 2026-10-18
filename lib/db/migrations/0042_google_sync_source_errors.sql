-- ADDITIVE ONLY: preserve per-source connector sync failures for diagnostics.

BEGIN;

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "source_errors" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
