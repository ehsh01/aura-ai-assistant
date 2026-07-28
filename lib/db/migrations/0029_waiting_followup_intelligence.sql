-- Follow-up intelligence on the existing waiting_items model:
-- optional project/task links, and candidates join the dedupe guarantee.
ALTER TABLE waiting_items
  ADD COLUMN IF NOT EXISTS project_id varchar(64),
  ADD COLUMN IF NOT EXISTS task_id varchar(64);

-- Uncertain candidates live in the same table with status 'candidate'; they
-- must dedupe against reprocessing just like open/snoozed commitments, so the
-- active-fingerprint index predicate widens to include them.
DROP INDEX IF EXISTS waiting_items_active_fingerprint_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS waiting_items_active_fingerprint_uidx
  ON waiting_items(user_id, fingerprint)
  WHERE status in ('open', 'snoozed', 'candidate');
