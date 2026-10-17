import { PGlite } from "@electric-sql/pglite";

const MODE = process.argv[2] === "legacy" ? "legacy" : "bounded";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_COUNT = 5_000;
const LARGE_TEXT_CHARS = 8_192;

function heapUsed(): number {
  return process.memoryUsage().heapUsed;
}

const db = new PGlite();
await db.exec(`
  CREATE TABLE notes (
    id varchar(64) PRIMARY KEY,
    user_id uuid NOT NULL,
    title varchar(500) NOT NULL,
    content text NOT NULL,
    preview text NOT NULL,
    content_format varchar(16) NOT NULL DEFAULT 'plain',
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    pinned boolean NOT NULL DEFAULT false,
    notebook_id varchar(64),
    project_id varchar(64),
    primary_person_id varchar(64),
    search_document text NOT NULL DEFAULT '',
    search_tsv tsvector,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  );
  CREATE TABLE note_attachments (
    id varchar(128) PRIMARY KEY,
    note_id varchar(64) NOT NULL,
    extracted_text text
  );
  INSERT INTO notes (
    id, user_id, title, content, preview, search_document, created_at, updated_at
  )
  SELECT
    'note-' || lpad(g::text, 5, '0'),
    '${USER_ID}',
    'Note ' || g,
    repeat('B', ${LARGE_TEXT_CHARS}),
    'Preview ' || g,
    repeat('B', ${LARGE_TEXT_CHARS}) || repeat('O', ${LARGE_TEXT_CHARS}),
    '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 second',
    '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 second'
  FROM generate_series(1, ${NOTE_COUNT}) g;
  INSERT INTO note_attachments (id, note_id, extracted_text)
  SELECT
    'attachment-' || lpad(g::text, 5, '0'),
    'note-' || lpad(g::text, 5, '0'),
    repeat('O', ${LARGE_TEXT_CHARS})
  FROM generate_series(1, ${NOTE_COUNT}) g;
`);

globalThis.gc?.();
const baseline = heapUsed();
let peak = baseline;
const rssBaseline = process.memoryUsage().rss;
let peakRss = rssBaseline;
let rows: Record<string, unknown>[];
let retainedLegacyRows: Record<string, unknown>[] = [];

if (MODE === "legacy") {
  const noteResult = await db.query<Record<string, unknown>>(`
    SELECT *
    FROM notes
    WHERE user_id = '${USER_ID}'
    ORDER BY updated_at DESC
  `);
  peak = Math.max(peak, heapUsed());
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const attachmentResult = await db.query<Record<string, unknown>>(`
    SELECT note_id, extracted_text
    FROM note_attachments
  `);
  peak = Math.max(peak, heapUsed());
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  retainedLegacyRows = [...noteResult.rows, ...attachmentResult.rows];
  rows = noteResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    preview: row.preview,
    tags: row.tags,
    updatedAt: row.updated_at,
  }));
} else {
  const result = await db.query<Record<string, unknown>>(`
    SELECT
      n.id,
      n.title,
      left(n.preview, 280) AS preview,
      n.content_format,
      n.tags,
      n.pinned,
      n.notebook_id,
      n.project_id,
      n.primary_person_id,
      (
        SELECT cast(count(*) AS integer)
        FROM note_attachments a
        WHERE a.note_id = n.id
      ) AS attachment_count,
      n.created_at,
      n.updated_at
    FROM notes n
    WHERE n.user_id = '${USER_ID}'
    ORDER BY n.updated_at DESC, n.id DESC
    LIMIT 101
  `);
  peak = Math.max(peak, heapUsed());
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  rows = result.rows.slice(0, 100);
}

const payload = JSON.stringify({
  notes: rows,
  hasMore: MODE === "bounded",
  nextCursor: MODE === "bounded" ? "opaque-cursor" : null,
});
peak = Math.max(peak, heapUsed());
peakRss = Math.max(peakRss, process.memoryUsage().rss);

console.log(
  JSON.stringify({
    mode: MODE,
    seededNotes: NOTE_COUNT,
    bodyCharsPerNote: LARGE_TEXT_CHARS,
    ocrCharsPerNote: LARGE_TEXT_CHARS,
    returnedNotes: rows.length,
    retainedLegacyRows: retainedLegacyRows.length,
    responseBytes: Buffer.byteLength(payload),
    heapBaselineBytes: baseline,
    peakHeapBytes: peak,
    heapDeltaBytes: peak - baseline,
    rssBaselineBytes: rssBaseline,
    peakRssBytes: peakRss,
    rssDeltaBytes: peakRss - rssBaseline,
  }),
);

await db.close();
