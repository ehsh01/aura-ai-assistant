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
adds free Postgres full-text search seeding. Each page allocates a fixed
fraction of its item budget to every source and applies a per-source
`LIMIT/OFFSET`; the server never builds the full corpus in memory. The maximum
response stays 500 nodes, the standard desktop page is 350, and mobile uses an
explicit 180-node page with Newer/Older controls.

Submitting a free one-box search also loads `q` into the graph. Paging preserves
that query. Search still does not invoke AI.

## Display-only twin suppression

A native `notes` row is omitted when a live Evernote source record for the same
user has an exact title after trim/case normalization. The anti-join runs before
the native-note source cap, so July import twins do not consume graph slots.
Saved `items` are not suppressed. Trashed Evernote records do not suppress a
native note.

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

## Verification

Coverage includes source-type mapping, query parsing, display-only twin
suppression, normalized and filtered hubs, non-rendered hub prevention,
notebook fanout caps, search-seeded graph requests, and query-preserving paging.
The screenshot harness uses deterministic mixed-source car/house test data at
1280×800 and 390×844.
