-- Organizations + invoices for Phase 4 domain expansion.
-- Additive + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "org_type" varchar(32) NOT NULL DEFAULT 'other',
  "email" varchar(255),
  "phone" varchar(64),
  "website" varchar(500),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "organizations_user_id_idx" ON "organizations" ("user_id");
CREATE INDEX IF NOT EXISTS "organizations_display_name_idx" ON "organizations" ("display_name");

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(500) NOT NULL,
  "organization_id" varchar(64) REFERENCES "organizations"("id") ON DELETE SET NULL,
  "amount_cents" integer,
  "currency" varchar(8) NOT NULL DEFAULT 'USD',
  "status" varchar(16) NOT NULL DEFAULT 'open',
  "invoice_date" varchar(10),
  "due_date" varchar(10),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices" ("user_id");
CREATE INDEX IF NOT EXISTS "invoices_org_idx" ON "invoices" ("user_id", "organization_id");
CREATE INDEX IF NOT EXISTS "invoices_due_date_idx" ON "invoices" ("user_id", "due_date");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" ("user_id", "status");

COMMIT;
