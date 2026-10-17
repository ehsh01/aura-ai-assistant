BEGIN;

-- Content-addressed AI results. A deterministic fallback is inserted before
-- the provider call, so a failed attempt remains closed and is not retried by
-- a page reload with the same inputs.
CREATE TABLE IF NOT EXISTS ai_result_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature varchar(64) NOT NULL,
  input_hash varchar(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_result_cache_user_feature_hash_idx
  ON ai_result_cache (user_id, feature, input_hash);

CREATE INDEX IF NOT EXISTS ai_result_cache_user_feature_created_idx
  ON ai_result_cache (user_id, feature, created_at DESC);

COMMIT;
