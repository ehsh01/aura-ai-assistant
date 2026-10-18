-- Additive metadata for non-text AI calls. Never stores prompts, transcripts,
-- answers, or synthesized text.
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS provider varchar(32),
  ADD COLUMN IF NOT EXISTS characters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seconds integer NOT NULL DEFAULT 0;
