-- Additive channel / context / identity / vault columns. Existing rows keep defaults.
-- Safe to apply on a live database: no drops, no rewrites of existing values.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sms_inbound_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_home_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS working_person_id varchar(64),
  ADD COLUMN IF NOT EXISTS working_project_id varchar(64),
  ADD COLUMN IF NOT EXISTS last_sms_proposal_id varchar(64),
  ADD COLUMN IF NOT EXISTS last_sms_thread_id varchar(64);

CREATE TABLE IF NOT EXISTS person_identities (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id varchar(64) NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  value varchar(320) NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  source varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS person_identities_user_kind_value_idx
  ON person_identities (user_id, kind, value);

CREATE INDEX IF NOT EXISTS person_identities_person_idx
  ON person_identities (person_id);

CREATE INDEX IF NOT EXISTS person_identities_user_idx
  ON person_identities (user_id);

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS vault varchar(32) NOT NULL DEFAULT 'personal';

ALTER TABLE life_memories
  ADD COLUMN IF NOT EXISTS vault varchar(32) NOT NULL DEFAULT 'personal';

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS vault varchar(32) NOT NULL DEFAULT 'personal';
