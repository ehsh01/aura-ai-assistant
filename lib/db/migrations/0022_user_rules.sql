-- Per-user Ask rules (ordered text instructions injected into Ask prompts).
CREATE TABLE IF NOT EXISTS user_rules (
  id varchar(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_rules_user_sort_idx ON user_rules (user_id, sort_order);
