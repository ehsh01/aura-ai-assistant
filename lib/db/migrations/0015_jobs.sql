-- Durable background job queue (capture extraction first).
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "jobs" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(32) NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "last_error" text,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "locked_at" timestamptz,
  "locked_by" varchar(128),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "jobs_claim_idx"
  ON "jobs" ("status", "available_at", "created_at");
CREATE INDEX IF NOT EXISTS "jobs_user_type_idx"
  ON "jobs" ("user_id", "type", "created_at");

COMMIT;
