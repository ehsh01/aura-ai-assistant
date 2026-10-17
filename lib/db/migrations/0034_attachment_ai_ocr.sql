-- Distinguish free local extraction from explicit, user-triggered vision OCR.
-- Additive and safe for DigitalOcean managed Postgres.
ALTER TABLE note_attachments
  ADD COLUMN IF NOT EXISTS ai_ocr_at timestamptz;

CREATE INDEX IF NOT EXISTS note_attachments_user_ai_ocr_hash_idx
  ON note_attachments (user_id, content_hash)
  WHERE content_hash IS NOT NULL AND ai_ocr_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS note_attachments_content_hash_idx
  ON note_attachments (content_hash)
  WHERE content_hash IS NOT NULL;
