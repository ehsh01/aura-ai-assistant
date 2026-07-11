-- Persistent Ask conversation threads for follow-up questions.
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "ask_threads" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(500) NOT NULL DEFAULT 'New chat',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ask_threads_user_updated_idx"
  ON "ask_threads" ("user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "ask_messages" (
  "id" varchar(64) PRIMARY KEY,
  "thread_id" varchar(64) NOT NULL REFERENCES "ask_threads"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(16) NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ask_messages_thread_created_idx"
  ON "ask_messages" ("thread_id", "created_at");

CREATE INDEX IF NOT EXISTS "ask_messages_user_id_idx"
  ON "ask_messages" ("user_id");

COMMIT;
