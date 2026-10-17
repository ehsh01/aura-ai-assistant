-- Keyset pagination for the bounded note-metadata endpoints.
-- Numbered after the planned 0039_saved_items migration.

CREATE INDEX IF NOT EXISTS "notes_user_updated_id_idx"
  ON "notes" ("user_id", "updated_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "note_attachments_note_id_idx"
  ON "note_attachments" ("note_id");
