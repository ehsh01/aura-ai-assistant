-- Searchable text extracted from note attachments (PDF OCR/text, image OCR, etc.).
-- Additive + idempotent.

BEGIN;

ALTER TABLE "note_attachments"
  ADD COLUMN IF NOT EXISTS "extracted_text" text;

ALTER TABLE "note_attachments"
  ADD COLUMN IF NOT EXISTS "extracted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "note_attachments_extract_pending_idx"
  ON "note_attachments" ("extracted_at")
  WHERE "extracted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "note_attachments_note_extracted_idx"
  ON "note_attachments" ("note_id")
  WHERE "extracted_text" IS NOT NULL AND length(trim("extracted_text")) > 0;

COMMIT;
