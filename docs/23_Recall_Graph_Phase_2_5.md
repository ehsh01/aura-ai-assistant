# Recall graph Phase 2.5

Status: implemented on top of Recall one-box Phase 1.

## Product contract

- The user-facing name is **Recall**.
- Linking remains deterministic. This phase adds no AI/LLM call, embedding query,
  embedding backfill, background batch, or connector write.
- Evernote remains read-only.
- Native notes with an exact, normalized-title Evernote twin are hidden from
  graph reads only. Neither copy is updated or deleted.
- No migration is required.

## Sources and paging

`GET /api/items/graph` now includes bounded pages from:

- Recall saves and native notes
- Evernote
- Gmail
- Drive
- Calendar
- finance transactions
- FlipperForce projects
- Homey devices
- life memories
- tasks
- Google contacts

The existing `limit`, `offset`, and `types` parameters remain supported. `q`
adds free Postgres full-text search seeding with deterministic any-word terms.
Each page starts with a weighted source budget, caps shares at the source row
count, and gives unused shares back to sources with remaining rows. The eight
connector record types use one narrow ranked query. The maximum response stays
500 nodes, the standard desktop page is 350, and mobile uses an explicit
180-node page with Newer/Older controls.

Submitting a free one-box search extracts up to eight keywords for the graph;
natural-language filler is never sent as an ANDed graph query. Paging preserves
the seed, a zero-match page falls back to the unseeded graph, and Clear returns
to the unseeded graph. Search still does not invoke AI.

## Display-only twin suppression

A native `notes` row is omitted when a live Evernote source record for the same
user has an exact title after trim/case normalization. The anti-join runs before
the native-note source cap, so July import twins do not consume graph slots.
Saved `items` are not suppressed. Trashed Evernote records do not suppress a
native note.

The Evernote title loader filters to `record_type = 'evernote_note'` before
JSONB and regexp work, then caches the normalized title array per user for 60
seconds. Count, native-note, and noisy-notebook queries reuse that array through
a single `text[]` bind parameter, a `MATERIALIZED` CTE, and
`LEFT JOIN ... IS NULL`. The one-parameter binding avoids PostgreSQL's 1,664
ROW-entry limit even above 5,000 titles, while preserving the hash anti-join and
avoiding three title-set rebuilds per request. Every graph read runs in a
transaction with `SET LOCAL statement_timeout = '5s'`; page statements are
awaited sequentially so one `pg` client never executes concurrent queries. The
noisy-notebook set is cached per user for 30 seconds with a 100-user process
cap. Exact production EXPLAIN SQL is in
`docs/RECALL_GRAPH_P25_EXPLAIN.sql`.

## Hub de-noising

- A notebook containing more than 20% of the user's visible note population is
  non-linking.
- Notebook keys strip `(Space: …)`, whitespace, and punctuation differences, so
  display variants share one hub.
- Notebook and tag hubs require at least two rendered members.
- Hubs are derived only from rows that received a rendered item node.
- Graph tags are lower-cased; internal `notebook:`, `year:`, `date:`,
  `domain:`, `format:`, `person:`, `project:`, and `type:` facets are hidden.
- Item/tag degree remains capped at 8. Notebook hubs have an explicit 200-edge
  ceiling.

The existing graph edge width and opacity treatment is unchanged.

Digit runs of five or more characters in every graph label (including hubs and
all source types) are masked before they reach canvas labels, tooltips, or
accessibility text. The display keeps the last four digits and prefixes them
with `****`; shorter numbers and tooltip link counts remain unchanged.

## Verification

Coverage includes source-type mapping, query parsing, display-only twin
suppression, normalized and filtered hubs, non-rendered hub prevention,
notebook fanout caps, search-seeded graph requests, and query-preserving paging.
The screenshot harness uses deterministic mixed-source car/house test data at
1280×800 and 390×844.
