-- Recall Phases 2-10 migration (additive, idempotent)
-- Adds: evidence engine, AI extractions, people, corrections, connectors,
-- source records, documents, knowledge, audit log; extends tasks + capture_items.

BEGIN;

-- People (before task FKs)
CREATE TABLE IF NOT EXISTS "people" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "first_name" varchar(128),
  "last_name" varchar(128),
  "email" varchar(255),
  "phone" varchar(64),
  "organization" varchar(255),
  "department" varchar(255),
  "role" varchar(255),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "people_user_id_idx" ON "people" ("user_id");
CREATE INDEX IF NOT EXISTS "people_email_idx" ON "people" ("email");
CREATE INDEX IF NOT EXISTS "people_display_name_idx" ON "people" ("display_name");

-- AI extractions (requires captures from 0002)
CREATE TABLE IF NOT EXISTS "ai_extractions" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capture_id" varchar(64) NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "model_name" varchar(64),
  "prompt_version" varchar(32) NOT NULL,
  "raw_response" text,
  "structured_output" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence_score" real,
  "status" varchar(16) NOT NULL DEFAULT 'suggested',
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ai_extractions_capture_id_idx" ON "ai_extractions" ("capture_id");
CREATE INDEX IF NOT EXISTS "ai_extractions_user_id_idx" ON "ai_extractions" ("user_id");

-- Evidence
CREATE TABLE IF NOT EXISTS "evidence" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar(64) NOT NULL,
  "claim_type" varchar(64) NOT NULL,
  "source_capture_id" varchar(64) REFERENCES "captures"("id") ON DELETE SET NULL,
  "source_record_id" varchar(64),
  "evidence_text" text,
  "evidence_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "file_name" varchar(500),
  "file_id" varchar(64),
  "row_number" integer,
  "page_number" integer,
  "url" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "evidence_entity_idx" ON "evidence" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "evidence_source_capture_idx" ON "evidence" ("source_capture_id");
CREATE INDEX IF NOT EXISTS "evidence_user_id_idx" ON "evidence" ("user_id");

-- User corrections
CREATE TABLE IF NOT EXISTS "user_corrections" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar(64) NOT NULL,
  "field_name" varchar(64) NOT NULL,
  "old_value" text,
  "new_value" text,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_corrections_entity_idx" ON "user_corrections" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "user_corrections_user_id_idx" ON "user_corrections" ("user_id");

-- Connectors
CREATE TABLE IF NOT EXISTS "connectors" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "type" varchar(32) NOT NULL,
  "description" text,
  "base_url" text,
  "auth_type" varchar(32),
  "enabled" boolean NOT NULL DEFAULT true,
  "last_sync_at" timestamptz,
  "sync_status" varchar(32) NOT NULL DEFAULT 'disconnected',
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "connectors_user_id_idx" ON "connectors" ("user_id");
CREATE INDEX IF NOT EXISTS "connectors_type_idx" ON "connectors" ("type");

-- Sync runs
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "status" varchar(32) NOT NULL DEFAULT 'running',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "records_fetched" integer NOT NULL DEFAULT 0,
  "records_created" integer NOT NULL DEFAULT 0,
  "records_updated" integer NOT NULL DEFAULT 0,
  "records_failed" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "sync_runs_connector_id_idx" ON "sync_runs" ("connector_id");
CREATE INDEX IF NOT EXISTS "sync_runs_user_id_idx" ON "sync_runs" ("user_id");

-- Source records
CREATE TABLE IF NOT EXISTS "source_records" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connector_id" varchar(64) NOT NULL REFERENCES "connectors"("id") ON DELETE CASCADE,
  "external_id" varchar(255) NOT NULL,
  "record_type" varchar(32) NOT NULL,
  "record_title" varchar(500),
  "record_text" text,
  "record_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_url" text,
  "source_created_at" timestamptz,
  "source_updated_at" timestamptz,
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "source_records_connector_external_idx"
  ON "source_records" ("connector_id", "external_id");
CREATE INDEX IF NOT EXISTS "source_records_user_id_idx" ON "source_records" ("user_id");

-- Documents
CREATE TABLE IF NOT EXISTS "documents" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "file_name" varchar(500) NOT NULL,
  "file_type" varchar(64),
  "storage_path" text,
  "source_capture_id" varchar(64) REFERENCES "captures"("id") ON DELETE SET NULL,
  "extracted_text" text,
  "summary" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "documents_user_id_idx" ON "documents" ("user_id");

-- Knowledge items
CREATE TABLE IF NOT EXISTS "knowledge_items" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(500) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "item_type" varchar(32) NOT NULL DEFAULT 'note',
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "project_id" varchar(64) REFERENCES "projects"("id") ON DELETE SET NULL,
  "source_capture_id" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_items_user_id_idx" ON "knowledge_items" ("user_id");

-- Audit log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(64) NOT NULL,
  "entity_type" varchar(32),
  "entity_id" varchar(64),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" ("user_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" ("action");

-- Extend capture_items with raw_capture_id
ALTER TABLE "capture_items"
  ADD COLUMN IF NOT EXISTS "raw_capture_id" varchar(64);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'capture_items_raw_capture_id_captures_id_fk'
  ) THEN
    ALTER TABLE "capture_items"
      ADD CONSTRAINT "capture_items_raw_capture_id_captures_id_fk"
      FOREIGN KEY ("raw_capture_id") REFERENCES "captures"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Extend tasks with evidence / people fields
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "requester_person_id" varchar(64);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_capture_id" varchar(64);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "confidence_score" real;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ai_generated" boolean NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "user_confirmed" boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_requester_person_id_people_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_requester_person_id_people_id_fk"
      FOREIGN KEY ("requester_person_id") REFERENCES "people"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_source_capture_id_captures_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_source_capture_id_captures_id_fk"
      FOREIGN KEY ("source_capture_id") REFERENCES "captures"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
