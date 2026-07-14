-- Notes full-text search (tsvector + GIN).
-- Denormalized search_document includes title/preview/content/tags + attachment OCR text.
-- Additive + idempotent.

BEGIN;

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "search_document" text NOT NULL DEFAULT '';

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;

CREATE OR REPLACE FUNCTION recall_note_search_document(p_note_id varchar)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT trim(both E'\n' FROM concat_ws(E'\n',
    coalesce(n.title, ''),
    coalesce(n.preview, ''),
    coalesce(n.content, ''),
    coalesce(n.tags::text, ''),
    coalesce((
      SELECT string_agg(
        concat_ws(E'\n', coalesce(na.file_name, ''), coalesce(na.extracted_text, '')),
        E'\n'
      )
      FROM note_attachments na
      WHERE na.note_id = n.id
    ), '')
  ))
  FROM notes n
  WHERE n.id = p_note_id;
$$;

CREATE OR REPLACE FUNCTION recall_refresh_note_search(p_note_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  doc text;
BEGIN
  doc := coalesce(recall_note_search_document(p_note_id), '');
  UPDATE notes
  SET
    search_document = doc,
    search_tsv = to_tsvector('simple', doc)
  WHERE id = p_note_id;
END;
$$;

-- Keep FTS in sync when note body/tags change (does not fire when only search_* updates).
CREATE OR REPLACE FUNCTION recall_notes_search_before()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  att text;
BEGIN
  SELECT coalesce(string_agg(
    concat_ws(E'\n', coalesce(na.file_name, ''), coalesce(na.extracted_text, '')),
    E'\n'
  ), '')
  INTO att
  FROM note_attachments na
  WHERE na.note_id = NEW.id;

  NEW.search_document := trim(both E'\n' FROM concat_ws(E'\n',
    coalesce(NEW.title, ''),
    coalesce(NEW.preview, ''),
    coalesce(NEW.content, ''),
    coalesce(NEW.tags::text, ''),
    coalesce(att, '')
  ));
  NEW.search_tsv := to_tsvector('simple', coalesce(NEW.search_document, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recall_notes_search_before_trg ON notes;
CREATE TRIGGER recall_notes_search_before_trg
  BEFORE INSERT OR UPDATE OF title, preview, content, tags
  ON notes
  FOR EACH ROW
  EXECUTE PROCEDURE recall_notes_search_before();

CREATE OR REPLACE FUNCTION recall_note_attachments_search_after()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_note_id varchar(64);
BEGIN
  target_note_id := COALESCE(NEW.note_id, OLD.note_id);
  PERFORM recall_refresh_note_search(target_note_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recall_note_attachments_search_after_trg ON note_attachments;
CREATE TRIGGER recall_note_attachments_search_after_trg
  AFTER INSERT OR UPDATE OF file_name, extracted_text OR DELETE
  ON note_attachments
  FOR EACH ROW
  EXECUTE PROCEDURE recall_note_attachments_search_after();

-- Backfill existing notes.
UPDATE notes n
SET
  search_document = d.doc,
  search_tsv = to_tsvector('simple', d.doc)
FROM (
  SELECT id, coalesce(recall_note_search_document(id), '') AS doc
  FROM notes
) d
WHERE n.id = d.id;

CREATE INDEX IF NOT EXISTS "notes_search_tsv_gin"
  ON "notes" USING GIN ("search_tsv");

COMMIT;
