-- Persist dismissed waiting-on items so Follow up / Today can hide them.
CREATE TABLE IF NOT EXISTS waiting_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  waiting_item_id varchar(128) NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, waiting_item_id)
);

CREATE INDEX IF NOT EXISTS waiting_dismissals_user_id_idx
  ON waiting_dismissals (user_id);
