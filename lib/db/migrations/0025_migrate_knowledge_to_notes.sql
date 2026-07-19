-- Sidebar consolidation: fold the standalone Knowledge page into Notes.
--
-- Copies every knowledge_items row into notes (itemType preserved as a
-- "type:<itemType>" tag) so existing procedures/references/snippets/contacts
-- become browsable, searchable, and editable in the unified Notes page.
--
-- Deliberately additive, not destructive: knowledge_items rows are left in
-- place untouched, because they remain the source of truth for Ask retrieval,
-- waiting-on detection, and the document-extraction pipeline (services which
-- keep writing to that table going forward). Reusing the knowledge item's id
-- as the new note's id (safe — separate tables/primary-key spaces) means any
-- existing "Open knowledge"-style links can be repointed at /notes?note=<id>
-- without needing an id-mapping table.
INSERT INTO notes (
  id, user_id, notebook_id, project_id, primary_person_id,
  title, content, preview, tags, content_format, pinned,
  created_at, updated_at
)
SELECT
  k.id,
  k.user_id,
  NULL,
  k.project_id,
  k.primary_person_id,
  k.title,
  k.content,
  left(k.content, 240),
  (COALESCE(k.tags, '[]'::jsonb) || to_jsonb(ARRAY['type:' || k.item_type])),
  'plain',
  false,
  k.created_at,
  k.updated_at
FROM knowledge_items k
WHERE NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = k.id);
