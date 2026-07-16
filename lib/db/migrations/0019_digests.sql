-- Digests for token-efficient Ask (additive; originals retained).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_hash varchar(64);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS fact_bullets jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE life_memories ADD COLUMN IF NOT EXISTS summary text;

ALTER TABLE captures ADD COLUMN IF NOT EXISTS digest text;
