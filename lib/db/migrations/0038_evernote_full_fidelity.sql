-- Evernote full-fidelity, zero-AI import metadata.
-- Attachment bytes are never stored; only hashes, metadata, and extracted text remain.

BEGIN;

CREATE TABLE IF NOT EXISTS "evernote_containers" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "external_id" varchar(500) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "name" varchar(1000) NOT NULL,
  "parent_external_id" varchar(500),
  "stack_name" varchar(1000),
  "space_external_id" varchar(500),
  "access" varchar(64),
  "expected_note_count" integer,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_created_at" timestamptz,
  "source_updated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "evernote_containers_connector_external_kind_idx"
  ON "evernote_containers" ("connector_id", "external_id", "kind");
CREATE INDEX IF NOT EXISTS "evernote_containers_user_connector_idx"
  ON "evernote_containers" ("user_id", "connector_id");

CREATE TABLE IF NOT EXISTS "evernote_tags" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "external_id" varchar(500) NOT NULL,
  "name" varchar(1000) NOT NULL,
  "parent_external_id" varchar(500),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "evernote_tags_connector_external_idx"
  ON "evernote_tags" ("connector_id", "external_id");
CREATE INDEX IF NOT EXISTS "evernote_tags_user_connector_idx"
  ON "evernote_tags" ("user_id", "connector_id");

CREATE TABLE IF NOT EXISTS "evernote_tasks" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "source_record_id" varchar(64) REFERENCES "source_records"("id") ON DELETE CASCADE,
  "note_external_id" varchar(500),
  "external_id" varchar(500) NOT NULL,
  "label" text NOT NULL DEFAULT '',
  "description" text,
  "status" varchar(64),
  "due_at" timestamptz,
  "completed_at" timestamptz,
  "source_updated_at" timestamptz,
  "priority" varchar(64),
  "flagged" boolean NOT NULL DEFAULT false,
  "recurring" boolean NOT NULL DEFAULT false,
  "assignee" varchar(500),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "evernote_tasks_connector_external_idx"
  ON "evernote_tasks" ("connector_id", "external_id");
CREATE INDEX IF NOT EXISTS "evernote_tasks_source_record_idx"
  ON "evernote_tasks" ("source_record_id");
CREATE INDEX IF NOT EXISTS "evernote_tasks_note_external_idx"
  ON "evernote_tasks" ("connector_id", "note_external_id");

CREATE TABLE IF NOT EXISTS "evernote_attachments" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "source_record_id" varchar(64) NOT NULL REFERENCES "source_records"("id") ON DELETE CASCADE,
  "external_id" varchar(500) NOT NULL,
  "evernote_hash" varchar(128),
  "sha256" varchar(64),
  "mime" varchar(255),
  "file_name" text,
  "size_bytes" integer,
  "source_url" text,
  "extracted_text" text,
  "text_engine" varchar(32),
  "fetch_state" varchar(32) NOT NULL DEFAULT 'pending',
  "fetch_error" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "extracted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "evernote_attachments_source_external_idx"
  ON "evernote_attachments" ("source_record_id", "external_id");
CREATE INDEX IF NOT EXISTS "evernote_attachments_connector_state_idx"
  ON "evernote_attachments" ("connector_id", "fetch_state", "created_at");
CREATE INDEX IF NOT EXISTS "evernote_attachments_sha256_idx"
  ON "evernote_attachments" ("connector_id", "sha256");

ALTER TABLE "evernote_attachments"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(file_name, '') || E'\n' || left(coalesce(extracted_text, ''), 180000)
    )
  ) STORED;
CREATE INDEX IF NOT EXISTS "evernote_attachments_search_tsv_gin"
  ON "evernote_attachments" USING gin ("search_tsv");

CREATE TABLE IF NOT EXISTS "evernote_sync_state" (
  "connector_id" varchar(64) PRIMARY KEY REFERENCES "connectors"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "phase" varchar(32) NOT NULL DEFAULT 'structure',
  "cursor" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "report" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_incremental_at" timestamptz,
  "last_full_reconcile_at" timestamptz,
  "watchdog_paused_at" timestamptz,
  "watchdog_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "evernote_sync_state_user_idx"
  ON "evernote_sync_state" ("user_id");

COMMIT;
