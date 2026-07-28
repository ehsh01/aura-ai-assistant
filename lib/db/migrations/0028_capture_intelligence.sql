-- Effortless capture: classification confidence, structured link suggestions,
-- snooze lifecycle, and pipeline metadata on the existing capture_items inbox.
ALTER TABLE capture_items
  ADD COLUMN IF NOT EXISTS confidence double precision,
  ADD COLUMN IF NOT EXISTS suggested_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Retry-safety cleanup: past reprocessing could insert duplicate inbox rows per
-- raw capture. Dismiss all but the newest row for each raw_capture_id and clear
-- their raw_capture_id link so the unique index can be created (duplicates are
-- pipeline artifacts, not user data; the raw captures themselves are untouched).
UPDATE capture_items SET status = 'dismissed', raw_capture_id = NULL, updated_at = now()
WHERE raw_capture_id IS NOT NULL AND id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY raw_capture_id ORDER BY created_at DESC) AS rn
    FROM capture_items
    WHERE raw_capture_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Idempotent reprocessing: one inbox row per raw capture, enforced by the DB.
CREATE UNIQUE INDEX IF NOT EXISTS capture_items_raw_capture_unique
  ON capture_items(raw_capture_id)
  WHERE raw_capture_id IS NOT NULL;
