-- Recall Command Center migration (additive, idempotent)
-- Adds: projects, capture_items tables and project_id columns on notes/tasks.
-- Safe to run multiple times. Order respects foreign-key dependencies.

BEGIN;

-- 1. Projects (must exist before capture_items / project_id FKs)
CREATE TABLE IF NOT EXISTS "projects" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(500) NOT NULL,
  "description" text,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "related_people" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");

-- 2. Capture items (AI Inbox)
CREATE TABLE IF NOT EXISTS "capture_items" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "raw_text" text NOT NULL,
  "cleaned_title" varchar(500) NOT NULL DEFAULT 'Untitled capture',
  "suggested_type" varchar(32) NOT NULL DEFAULT 'note',
  "suggested_priority" varchar(16) NOT NULL DEFAULT 'medium',
  "suggested_due_date" varchar(64),
  "suggested_project" varchar(500),
  "suggested_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "suggested_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "project_id" varchar(64) REFERENCES "projects"("id") ON DELETE SET NULL,
  "notebook_id" varchar(64) REFERENCES "notebooks"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "capture_items_user_id_idx" ON "capture_items" ("user_id");
CREATE INDEX IF NOT EXISTS "capture_items_status_idx" ON "capture_items" ("user_id", "status");

-- 3. project_id link column on notes
ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "project_id" varchar(64);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notes_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- 4. project_id link column on tasks
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "project_id" varchar(64);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_project_id_projects_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
