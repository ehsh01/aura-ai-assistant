-- Deadline intelligence on the existing attention_items model (no parallel tables):
-- date confidence, timezone/time precision, user confirmation, and entity links.
ALTER TABLE attention_items
  ADD COLUMN IF NOT EXISTS date_confidence varchar(16) NOT NULL DEFAULT 'certain',
  ADD COLUMN IF NOT EXISTS time_zone varchar(64),
  ADD COLUMN IF NOT EXISTS time_known boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS task_id varchar(64),
  ADD COLUMN IF NOT EXISTS organization_id varchar(64),
  ADD COLUMN IF NOT EXISTS waiting_item_id varchar(64);

-- Legacy rows were only auto-created from explicit dates (confidence >= 0.75),
-- so treat them as confirmed instead of nagging the user about history.
UPDATE attention_items SET confirmed_at = created_at WHERE confirmed_at IS NULL;
