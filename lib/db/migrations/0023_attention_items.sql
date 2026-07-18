-- Deadline / appointment attention items with seen / dismiss / snooze lifecycle.
CREATE TABLE IF NOT EXISTS attention_items (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(500) NOT NULL,
  summary text,
  due_at timestamptz NOT NULL,
  kind varchar(32) NOT NULL DEFAULT 'deadline',
  status varchar(32) NOT NULL DEFAULT 'open',
  seen_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  completed_at timestamptz,
  source_entity_type varchar(32) NOT NULL,
  source_entity_id varchar(64) NOT NULL,
  evidence_text text,
  person_id varchar(64),
  project_id varchar(64),
  confidence real,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attention_items_source_due_uidx
  ON attention_items (user_id, source_entity_type, source_entity_id, due_at);

CREATE INDEX IF NOT EXISTS attention_items_user_status_due_idx
  ON attention_items (user_id, status, due_at);

CREATE INDEX IF NOT EXISTS attention_items_user_snooze_idx
  ON attention_items (user_id, snoozed_until)
  WHERE status = 'snoozed';
