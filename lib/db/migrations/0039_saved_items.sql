-- Unified saved-item cards (Recall-native notes, links, and images).
-- Evernote source_records stay immutable and are projected into the same API at read time.
-- Additive and idempotent; 0034 is intentionally skipped because two open PRs use it.

BEGIN;

CREATE TABLE IF NOT EXISTS "items" (
  "id" varchar(64) PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "capture_id" varchar(64) REFERENCES "captures"("id") ON DELETE SET NULL,
  "kind" varchar(32) NOT NULL,
  "state" varchar(16) NOT NULL DEFAULT 'ready',
  "source" varchar(32) NOT NULL DEFAULT 'recall',
  "title" varchar(500) NOT NULL,
  "description" text,
  "domain" varchar(255),
  "source_url" text,
  "canonical_url" text,
  "url_hash" varchar(64),
  "body_text" text NOT NULL DEFAULT '',
  "media" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notebook" varchar(500),
  "search_document" text NOT NULL DEFAULT '',
  "search_tsv" tsvector,
  "bumped_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "items_user_bumped_idx"
  ON "items" ("user_id", "bumped_at" DESC);
CREATE INDEX IF NOT EXISTS "items_user_kind_idx"
  ON "items" ("user_id", "kind");
CREATE INDEX IF NOT EXISTS "items_user_source_idx"
  ON "items" ("user_id", "source");
CREATE INDEX IF NOT EXISTS "items_user_notebook_idx"
  ON "items" ("user_id", "notebook");
CREATE UNIQUE INDEX IF NOT EXISTS "items_user_url_hash_unique"
  ON "items" ("user_id", "url_hash")
  WHERE "url_hash" IS NOT NULL;

CREATE OR REPLACE FUNCTION recall_items_search_before()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document := trim(both E'\n' FROM concat_ws(
    E'\n',
    coalesce(NEW.title, ''),
    coalesce(NEW.description, ''),
    coalesce(NEW.body_text, ''),
    coalesce(NEW.domain, ''),
    coalesce(NEW.notebook, ''),
    coalesce(NEW.tags::text, '')
  ));
  NEW.search_tsv := to_tsvector('simple', NEW.search_document);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recall_items_search_before_trg ON "items";
CREATE TRIGGER recall_items_search_before_trg
  BEFORE INSERT OR UPDATE OF title, description, body_text, domain, notebook, tags
  ON "items"
  FOR EACH ROW
  EXECUTE FUNCTION recall_items_search_before();

UPDATE "items"
SET
  "search_document" = trim(both E'\n' FROM concat_ws(
    E'\n',
    coalesce("title", ''),
    coalesce("description", ''),
    coalesce("body_text", ''),
    coalesce("domain", ''),
    coalesce("notebook", ''),
    coalesce("tags"::text, '')
  )),
  "search_tsv" = to_tsvector(
    'simple',
    concat_ws(
      E'\n',
      coalesce("title", ''),
      coalesce("description", ''),
      coalesce("body_text", ''),
      coalesce("domain", ''),
      coalesce("notebook", ''),
      coalesce("tags"::text, '')
    )
  );

CREATE INDEX IF NOT EXISTS "items_search_tsv_gin"
  ON "items" USING GIN ("search_tsv");

COMMIT;
