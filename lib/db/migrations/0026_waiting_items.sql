-- Durable "waiting on someone else" commitments (owner owes deliverable).
-- Lifecycle: open/snoozed/completed/dismissed; history via audit_log + evidence.
CREATE TABLE IF NOT EXISTS waiting_items (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_person_id varchar(64),
  owner_name varchar(200) NOT NULL,
  owner_org varchar(200),
  deliverable text NOT NULL,
  promised_at timestamptz,
  expected_at timestamptz,
  date_confidence varchar(16) NOT NULL DEFAULT 'none',
  status varchar(24) NOT NULL DEFAULT 'open',
  follow_up_at timestamptz,
  snoozed_until timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  last_outcome varchar(24),
  last_reply_source_record_id varchar(64),
  confidence real NOT NULL DEFAULT 0.5,
  fingerprint varchar(300) NOT NULL,
  thread_id varchar(128),
  source_entity_type varchar(32) NOT NULL,
  source_entity_id varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active commitment per owner+deliverable fingerprint; reopening/terminal
-- rows don't block a new commitment for the same fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS waiting_items_active_fingerprint_uidx
  ON waiting_items (user_id, fingerprint)
  WHERE status IN ('open', 'snoozed');

CREATE INDEX IF NOT EXISTS waiting_items_user_status_followup_idx
  ON waiting_items (user_id, status, follow_up_at);

CREATE INDEX IF NOT EXISTS waiting_items_user_thread_idx
  ON waiting_items (user_id, thread_id);
