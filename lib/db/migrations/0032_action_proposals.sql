-- Durable action proposals for Voice First confirm / correct / cancel.
-- Proposals are server-owned so replaying confirm cannot double-execute,
-- and corrections supersede prior versions with a full audit trail.
CREATE TABLE IF NOT EXISTS action_proposals (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id varchar(64),
  capture_id varchar(64),
  action_type varchar(32) NOT NULL,
  label varchar(128) NOT NULL DEFAULT '',
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text NOT NULL DEFAULT '',
  confidence real NOT NULL DEFAULT 0,
  risk_level varchar(16) NOT NULL DEFAULT 'low',
  confirmation_required boolean NOT NULL DEFAULT true,
  status varchar(24) NOT NULL DEFAULT 'proposed',
  -- proposed | confirmed | executed | cancelled | superseded | failed
  version integer NOT NULL DEFAULT 1,
  supersedes_id varchar(64),
  idempotency_key varchar(128),
  executed_entity_type varchar(64),
  executed_entity_id varchar(64),
  model varchar(96),
  prompt_version varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_proposals_user_status_idx
  ON action_proposals (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS action_proposals_thread_idx
  ON action_proposals (user_id, thread_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS action_proposals_idempotency_uidx
  ON action_proposals (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Content hash of attachment file bytes so the same image is never OCR'd twice
-- for the same user, even across different notes.
ALTER TABLE note_attachments
  ADD COLUMN IF NOT EXISTS content_hash varchar(64);

CREATE INDEX IF NOT EXISTS note_attachments_user_content_hash_idx
  ON note_attachments (user_id, content_hash)
  WHERE content_hash IS NOT NULL;
