-- Evernote v1: explicit sync skip counts plus connector-record FTS.
-- The trigger only runs for created/changed records; unchanged Evernote notes
-- are not updated by the sync pipeline.

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "records_skipped" integer NOT NULL DEFAULT 0;

ALTER TABLE "source_records"
  ADD COLUMN IF NOT EXISTS "search_document" text NOT NULL DEFAULT '';

ALTER TABLE "source_records"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;

CREATE OR REPLACE FUNCTION recall_source_records_search_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document := concat_ws(
    E'\n',
    coalesce(NEW.record_title, ''),
    coalesce(NEW.record_text, ''),
    coalesce(NEW.record_metadata->>'notebookName', ''),
    coalesce(NEW.record_metadata->>'tags', '')
  );
  NEW.search_tsv := to_tsvector('simple', NEW.search_document);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_records_search_refresh ON "source_records";
CREATE TRIGGER source_records_search_refresh
BEFORE INSERT OR UPDATE OF record_title, record_text, record_metadata
ON "source_records"
FOR EACH ROW
EXECUTE FUNCTION recall_source_records_search_refresh();

UPDATE "source_records"
SET
  search_document = concat_ws(
    E'\n',
    coalesce(record_title, ''),
    coalesce(record_text, ''),
    coalesce(record_metadata->>'notebookName', ''),
    coalesce(record_metadata->>'tags', '')
  ),
  search_tsv = to_tsvector(
    'simple',
    concat_ws(
      E'\n',
      coalesce(record_title, ''),
      coalesce(record_text, ''),
      coalesce(record_metadata->>'notebookName', ''),
      coalesce(record_metadata->>'tags', '')
    )
  );

CREATE INDEX IF NOT EXISTS source_records_search_tsv_gin
  ON "source_records"
  USING gin ("search_tsv");
