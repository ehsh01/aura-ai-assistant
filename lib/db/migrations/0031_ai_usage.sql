-- Per-call OpenAI usage so spend is attributable to a feature, and so the
-- background budget guard has something to measure. Rows are metadata only:
-- no prompt or completion content is stored.
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  -- Which part of the product spent the money, e.g. attachment_ocr, ask_query.
  feature varchar(64) NOT NULL,
  model varchar(96) NOT NULL,
  -- True when the call was made by a background job rather than a user action.
  background boolean NOT NULL DEFAULT false,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  -- Micro-dollars (1e-6 USD) to keep exact integer math on tiny per-call costs.
  cost_micros bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Serves the "spend since midnight" guard and the usage summary endpoint.
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_feature_idx ON ai_usage (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage (user_id, created_at DESC);
