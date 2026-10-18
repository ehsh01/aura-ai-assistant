-- Recall graph P2.5 production EXPLAIN harness.
--
-- This is the exact SQL shape used by item-graph.ts. Drizzle replaces the
-- psql variables below with bind parameters. Set the user and per-source
-- quotas to the values being checked, then run with a read-only role.
--
-- No statement below writes data. The optional index proposal at the end is
-- documentation only and is intentionally commented out.

\set user_id '00000000-0000-0000-0000-000000000000'
\set ts_query 'psychiatry'
-- Default below is the unseeded whole-graph shape.
\set item_search 'true'
\set note_search 'true'
\set source_search 'true'
\set memory_search 'true'
\set task_search 'true'
-- For the seeded Psychiatry shape, replace the five variables above with:
-- \set item_search 'i.search_tsv @@ to_tsquery(''simple'', :'':ts_query'')'
-- \set note_search 'n.search_tsv @@ to_tsquery(''simple'', :'':ts_query'')'
-- \set source_search 'sr.search_tsv @@ to_tsquery(''simple'', :'':ts_query'')'
-- \set memory_search 'to_tsvector(''simple'', concat_ws(E''\\n'', m.title, m.content, m.tags::text)) @@ to_tsquery(''simple'', :'':ts_query'')'
-- \set task_search 'to_tsvector(''simple'', concat_ws(E''\\n'', t.title, t.tags::text)) @@ to_tsquery(''simple'', :'':ts_query'')'
\set item_limit 1
\set item_offset 0
\set note_limit 1
\set note_offset 0
\set memory_limit 1
\set memory_offset 0
\set task_limit 1
\set task_offset 0

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';

-- Query 0: normalized Evernote-title cache loader. The API executes this only
-- on a per-user 60-second cache miss. record_type is applied before JSONB and
-- regexp work, so non-Evernote source rows never enter normalization.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH evernote_rows AS MATERIALIZED (
  SELECT sr.connector_id, sr.record_title, sr.record_metadata
  FROM source_records sr
  WHERE sr.user_id = :'user_id'::uuid
    AND sr.record_type = 'evernote_note'
)
SELECT DISTINCT
  lower(regexp_replace(btrim(coalesce(er.record_title, '')), '[[:space:]]+', ' ', 'g')) AS title_norm
FROM evernote_rows er
JOIN connectors c ON c.id = er.connector_id AND c.enabled = true
WHERE lower(coalesce(
    er.record_metadata->>'trashed',
    er.record_metadata->>'deleted',
    'false'
  )) NOT IN ('true', '1', 'yes')
  AND btrim(coalesce(er.record_title, '')) <> '';

-- Populate the psql variable used by Q1/Q3/Q7 exactly as the API's cached
-- single text[] bind parameter. The API uses sql.param(titles), not direct
-- array interpolation, so 5,000+ titles remain one PostgreSQL parameter.
-- Run this once per benchmark session/cache fill.
SELECT coalesce(array_agg(title_norm), '{}'::text[])::text AS evernote_titles
FROM (
  WITH evernote_rows AS MATERIALIZED (
    SELECT sr.connector_id, sr.record_title, sr.record_metadata
    FROM source_records sr
    WHERE sr.user_id = :'user_id'::uuid
      AND sr.record_type = 'evernote_note'
  )
  SELECT DISTINCT
    lower(regexp_replace(btrim(coalesce(er.record_title, '')), '[[:space:]]+', ' ', 'g')) AS title_norm
  FROM evernote_rows er
  JOIN connectors c ON c.id = er.connector_id AND c.enabled = true
  WHERE lower(coalesce(
      er.record_metadata->>'trashed',
      er.record_metadata->>'deleted',
      'false'
    )) NOT IN ('true', '1', 'yes')
    AND btrim(coalesce(er.record_title, '')) <> ''
) cached_titles
\gset

-- Query 1: counts used to redistribute unused source quotas.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH evernote_titles AS MATERIALIZED (
  SELECT unnest(:'evernote_titles'::text[]) AS title_norm
)
SELECT source_key, row_count
FROM (
  SELECT 'items'::text AS source_key, count(*)::int AS row_count
  FROM items i
  WHERE i.user_id = :'user_id'::uuid
    AND i.deleted_at IS NULL
    AND (
      i.kind = 'note'
      OR i.kind = 'link'
      OR i.kind IN ('image', 'pdf', 'file')
    )
    AND :item_search

  UNION ALL

  SELECT 'notes'::text AS source_key, count(*)::int AS row_count
  FROM notes n
  LEFT JOIN evernote_titles et
    ON et.title_norm =
      lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
  WHERE n.user_id = :'user_id'::uuid
    AND :note_search
    AND et.title_norm IS NULL

  UNION ALL

  SELECT sr.record_type AS source_key, count(*)::int AS row_count
  FROM source_records sr
  JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
  WHERE sr.user_id = :'user_id'::uuid
    AND sr.record_type IN (
      'evernote_note',
      'gmail_message',
      'drive_file',
      'calendar_event',
      'finance_transaction',
      'flipperforce_project',
      'homey_device',
      'google_contact'
    )
    AND :source_search
    AND (
      sr.record_type <> 'evernote_note'
      OR lower(coalesce(
        sr.record_metadata->>'trashed',
        sr.record_metadata->>'deleted',
        'false'
      )) NOT IN ('true', '1', 'yes')
    )
  GROUP BY sr.record_type

  UNION ALL

  SELECT 'memories'::text AS source_key, count(*)::int AS row_count
  FROM life_memories m
  WHERE m.user_id = :'user_id'::uuid
    AND m.status = 'active'
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND :memory_search

  UNION ALL

  SELECT 'tasks'::text AS source_key, count(*)::int AS row_count
  FROM tasks t
  WHERE t.user_id = :'user_id'::uuid
    AND :task_search
) counts;

-- Query 2: Recall saved-item page.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT
  'items'::text AS source_key,
  i.id, i.kind, i.source, i.title, i.description, i.domain,
  i.source_url, left(i.body_text, 2000) AS body_text,
  i.media, i.tags, i.notebook, i.bumped_at, i.created_at, i.updated_at
FROM items i
WHERE i.user_id = :'user_id'::uuid
  AND i.deleted_at IS NULL
  AND (
    i.kind = 'note'
    OR i.kind = 'link'
    OR i.kind IN ('image', 'pdf', 'file')
  )
  AND :item_search
ORDER BY i.bumped_at DESC, i.id DESC
LIMIT :item_limit + 1
OFFSET :item_offset;

-- Query 3: native-note page with the materialized Evernote title hash side.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH evernote_titles AS MATERIALIZED (
  SELECT unnest(:'evernote_titles'::text[]) AS title_norm
)
SELECT
  'notes'::text AS source_key,
  concat('note:', n.id) AS id,
  'note' AS kind,
  'recall' AS source,
  n.title,
  null::text AS description,
  null::text AS domain,
  null::text AS source_url,
  left(n.preview, 2000) AS body_text,
  '{}'::jsonb AS media,
  n.tags,
  nb.name AS notebook,
  n.updated_at AS bumped_at,
  n.created_at,
  n.updated_at
FROM notes n
LEFT JOIN notebooks nb ON nb.id = n.notebook_id
LEFT JOIN evernote_titles et
  ON et.title_norm =
    lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
WHERE n.user_id = :'user_id'::uuid
  AND :note_search
  AND et.title_norm IS NULL
ORDER BY n.updated_at DESC, n.id DESC
LIMIT :note_limit + 1
OFFSET :note_offset;

-- Query 4: all connector sources in one narrow ranking pass.
-- Replace the quota values with the quotas returned by the application count
-- allocator. These example values deliberately give Psychiatry/Evernote room.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH quota_config(source_key, row_offset, row_limit) AS (
  VALUES
    ('items'::text, 0, 1),
    ('notes'::text, 0, 1),
    ('evernote_note'::text, 0, 64),
    ('gmail_message'::text, 0, 42),
    ('drive_file'::text, 0, 30),
    ('calendar_event'::text, 0, 0),
    ('finance_transaction'::text, 0, 46),
    ('flipperforce_project'::text, 0, 2),
    ('homey_device'::text, 0, 1),
    ('google_contact'::text, 0, 24),
    ('memories'::text, 0, 20),
    ('tasks'::text, 0, 18)
),
ranked_source_ids AS (
  SELECT
    sr.id,
    sr.record_type AS source_key,
    row_number() OVER (
      PARTITION BY sr.record_type
      ORDER BY coalesce(sr.source_updated_at, sr.updated_at) DESC, sr.id DESC
    ) AS rn
  FROM source_records sr
  JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
  WHERE sr.user_id = :'user_id'::uuid
    AND sr.record_type IN (
      'evernote_note',
      'gmail_message',
      'drive_file',
      'finance_transaction',
      'flipperforce_project',
      'homey_device',
      'google_contact'
    )
    AND :source_search
    AND (
      sr.record_type <> 'evernote_note'
      OR lower(coalesce(
        sr.record_metadata->>'trashed',
        sr.record_metadata->>'deleted',
        'false'
      )) NOT IN ('true', '1', 'yes')
    )
)
SELECT
  ranked.source_key,
  concat('source-record:', sr.id) AS id,
  sr.record_type AS kind,
  CASE sr.record_type
    WHEN 'evernote_note' THEN 'evernote'
    WHEN 'gmail_message' THEN 'gmail'
    WHEN 'drive_file' THEN 'drive'
    WHEN 'calendar_event' THEN 'calendar'
    WHEN 'finance_transaction' THEN 'finance'
    WHEN 'flipperforce_project' THEN 'flipperforce'
    WHEN 'homey_device' THEN 'homey'
    WHEN 'google_contact' THEN 'contact'
    ELSE 'connector'
  END AS source,
  coalesce(sr.record_title, 'Untitled') AS title,
  null::text AS description,
  null::text AS domain,
  sr.source_url,
  left(coalesce(sr.record_text, ''), 2000) AS body_text,
  '{}'::jsonb AS media,
  CASE
    WHEN sr.record_type = 'evernote_note'
      AND jsonb_typeof(sr.record_metadata->'tagNames') = 'array'
      THEN sr.record_metadata->'tagNames'
    WHEN sr.record_type = 'evernote_note'
      AND jsonb_typeof(sr.record_metadata->'tags') = 'array'
      THEN sr.record_metadata->'tags'
    ELSE '[]'::jsonb
  END AS tags,
  CASE
    WHEN sr.record_type = 'evernote_note'
      THEN sr.record_metadata->>'notebookName'
    ELSE null
  END AS notebook,
  coalesce(sr.source_updated_at, sr.updated_at) AS bumped_at,
  coalesce(sr.source_created_at, sr.created_at) AS created_at,
  coalesce(sr.source_updated_at, sr.updated_at) AS updated_at
FROM ranked_source_ids ranked
JOIN quota_config quota ON quota.source_key = ranked.source_key
JOIN source_records sr ON sr.id = ranked.id
WHERE quota.row_limit > 0
  AND ranked.rn > quota.row_offset
  AND ranked.rn <= quota.row_offset + quota.row_limit + 1
ORDER BY bumped_at DESC, id DESC;

-- Query 5: active life-memory page.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT
  'memories'::text AS source_key,
  concat('memory:', m.id) AS id,
  'memory' AS kind,
  'memory' AS source,
  m.title,
  m.summary AS description,
  null::text AS domain,
  null::text AS source_url,
  left(m.content, 2000) AS body_text,
  '{}'::jsonb AS media,
  m.tags,
  null::text AS notebook,
  m.updated_at AS bumped_at,
  m.created_at,
  m.updated_at
FROM life_memories m
WHERE m.user_id = :'user_id'::uuid
  AND m.status = 'active'
  AND (m.expires_at IS NULL OR m.expires_at > now())
  AND :memory_search
ORDER BY m.pinned DESC, m.updated_at DESC, m.id DESC
LIMIT :memory_limit + 1
OFFSET :memory_offset;

-- Query 6: task page.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT
  'tasks'::text AS source_key,
  concat('task:', t.id) AS id,
  'task' AS kind,
  'task' AS source,
  t.title,
  concat_ws(' · ', nullif(t.priority, 'none'), t.time) AS description,
  null::text AS domain,
  null::text AS source_url,
  ''::text AS body_text,
  '{}'::jsonb AS media,
  t.tags,
  null::text AS notebook,
  t.updated_at AS bumped_at,
  t.created_at,
  t.updated_at
FROM tasks t
WHERE t.user_id = :'user_id'::uuid
  AND :task_search
ORDER BY t.completed ASC, t.updated_at DESC, t.id DESC
LIMIT :task_limit + 1
OFFSET :task_offset;

-- Query 7: noisy-notebook set. The API caches this result per user for 30s.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH evernote_titles AS MATERIALIZED (
  SELECT unnest(:'evernote_titles'::text[]) AS title_norm
),
visible_notes AS (
  SELECT nb.name AS notebook
  FROM notes n
  LEFT JOIN notebooks nb ON nb.id = n.notebook_id
  LEFT JOIN evernote_titles et
    ON et.title_norm =
      lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
  WHERE n.user_id = :'user_id'::uuid
    AND et.title_norm IS NULL

  UNION ALL

  SELECT sr.record_metadata->>'notebookName' AS notebook
  FROM source_records sr
  JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
  WHERE sr.user_id = :'user_id'::uuid
    AND sr.record_type = 'evernote_note'
    AND lower(coalesce(
      sr.record_metadata->>'trashed',
      sr.record_metadata->>'deleted',
      'false'
    )) NOT IN ('true', '1', 'yes')
)
SELECT notebook, count(*)::int AS count
FROM visible_notes
GROUP BY notebook;

ROLLBACK;

-- Optional future optimization proposal only; NOT applied by P2.5:
--
-- CREATE INDEX CONCURRENTLY source_records_user_evernote_title_norm_idx
--   ON source_records (
--     user_id,
--     lower(regexp_replace(btrim(coalesce(record_title, '')), '[[:space:]]+', ' ', 'g'))
--   )
--   WHERE record_type = 'evernote_note';
