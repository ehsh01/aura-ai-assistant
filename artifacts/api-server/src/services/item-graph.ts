import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";
import { ITEM_GRAPH_BODY_MAX_CHARS, type SavedItemDto } from "./items";
import { isVisibleItemTag } from "./item-tags";

export const GRAPH_NODE_TYPES = [
  "notes",
  "notebooks",
  "tags",
  "links",
  "files",
  "evernote",
  "gmail",
  "drive",
  "calendar",
  "finance",
  "flipperforce",
  "homey",
  "memories",
  "tasks",
  "contacts",
] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export type GraphNode = {
  id: string;
  itemId: string | null;
  type: GraphNodeType;
  label: string;
  value: number;
  hub: boolean;
  href: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  signal: "tag" | "notebook" | "domain" | "backlink";
};

export type GraphQuery = {
  q: string;
  limit: number;
  offset: number;
  types: GraphNodeType[];
  maxEdgesPerNode: number;
  maxEdgesPerHub: number;
};

export function parseGraphQuery(query: Record<string, unknown>): GraphQuery {
  const rawTypes =
    typeof query.types === "string"
      ? query.types
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter((value): value is GraphNodeType =>
            (GRAPH_NODE_TYPES as readonly string[]).includes(value),
          )
      : [];
  const requestedLimit = Number(query.limit);
  const requestedOffset = Number(query.offset);
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 300) : "",
    // 500 keeps the 2D simulation smooth and query work bounded. Paging exposes more.
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500)
      : 350,
    offset: Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset), 0), 1_000)
      : 0,
    types: rawTypes.length ? [...new Set(rawTypes)] : [...GRAPH_NODE_TYPES],
    maxEdgesPerNode: 8,
    // Hubs are useful only as bounded summaries. In particular, never recreate
    // an unbounded default-notebook star.
    maxEdgesPerHub: 200,
  };
}

function itemGraphType(item: SavedItemDto): GraphNodeType {
  if (item.source === "evernote") return "evernote";
  if (item.source === "gmail") return "gmail";
  if (item.source === "drive") return "drive";
  if (item.source === "calendar") return "calendar";
  if (item.source === "finance") return "finance";
  if (item.source === "flipperforce") return "flipperforce";
  if (item.source === "homey") return "homey";
  if (item.source === "memory") return "memories";
  if (item.source === "task") return "tasks";
  if (item.source === "contact") return "contacts";
  if (item.kind === "link") return "links";
  if (["image", "pdf", "file"].includes(item.kind)) return "files";
  return "notes";
}

function normalizeNotebook(value: string): { key: string; label: string } {
  const label = value
    .replace(/\s*\(\s*space\s*:[^)]+\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    // Punctuation-only differences should not create twin hubs.
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    label,
  };
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isVisibleGraphTag(value: string): boolean {
  const tag = normalizeTag(value);
  return (
    Boolean(tag) &&
    isVisibleItemTag(tag) &&
    !/^(?:date|domain|format|person|project|type):/.test(tag)
  );
}

function normalizedTwinTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hideNativeNotesWithEvernoteTwin(
  items: SavedItemDto[],
): SavedItemDto[] {
  const evernoteTitles = new Set(
    items
      .filter((item) => item.source === "evernote")
      .map((item) => normalizedTwinTitle(item.title))
      .filter(Boolean),
  );
  return items.filter(
    (item) =>
      !(
        item.source === "recall" &&
        item.id.startsWith("note:") &&
        evernoteTitles.has(normalizedTwinTitle(item.title))
      ),
  );
}

function hubId(type: "tags" | "notebooks", key: string): string {
  return `${type}:${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}

function externalUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => match[0].replace(/[.,;!?]+$/, ""))
    .slice(0, 20);
}

export function buildKnowledgeGraph(
  itemRows: SavedItemDto[],
  query: GraphQuery,
  options: { noisyNotebookKeys?: ReadonlySet<string> } = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const allowed = new Set(query.types);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const edgeCounts = new Map<string, number>();
  const itemNodeIds = new Map<string, string>();
  const itemNodeLimit = graphItemLimit(query);

  for (const item of itemRows) {
    const type = itemGraphType(item);
    if (!allowed.has(type) || itemNodeIds.size >= itemNodeLimit) continue;
    const id = `item-node:${item.id}`;
    itemNodeIds.set(item.id, id);
    nodes.set(id, {
      id,
      itemId: item.id,
      type,
      label: item.title,
      value: Math.max(3, Math.min(18, 4 + item.tags.length)),
      hub: false,
      href: `/everything/${encodeURIComponent(item.id)}`,
    });
  }

  const addEdge = (
    source: string,
    target: string,
    signal: GraphEdge["signal"],
  ): void => {
    const sourceNode = nodes.get(source);
    const targetNode = nodes.get(target);
    if (!sourceNode || !targetNode || source === target) return;
    const sourceLimit = sourceNode.hub
      ? sourceNode.type === "notebooks"
        ? query.maxEdgesPerHub
        : query.maxEdgesPerNode
      : query.maxEdgesPerNode;
    const targetLimit = targetNode.hub
      ? targetNode.type === "notebooks"
        ? query.maxEdgesPerHub
        : query.maxEdgesPerNode
      : query.maxEdgesPerNode;
    if ((edgeCounts.get(source) ?? 0) >= sourceLimit) return;
    if ((edgeCounts.get(target) ?? 0) >= targetLimit) return;
    const id = [source, target].sort().join("~");
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, source, target, signal });
    edgeCounts.set(source, (edgeCounts.get(source) ?? 0) + 1);
    edgeCounts.set(target, (edgeCounts.get(target) ?? 0) + 1);
  };

  const renderedItems = itemRows.filter((item) => itemNodeIds.has(item.id));
  const notebookCounts = new Map<string, number>();
  const notebookLabels = new Map<string, string>();
  const notebookFilters = new Map<string, string>();
  const tagCounts = new Map<string, number>();
  for (const item of renderedItems) {
    if (item.notebook) {
      const notebook = normalizeNotebook(item.notebook);
      if (notebook.key) {
        notebookCounts.set(
          notebook.key,
          (notebookCounts.get(notebook.key) ?? 0) + 1,
        );
        if (!notebookLabels.has(notebook.key)) {
          notebookLabels.set(notebook.key, notebook.label);
          notebookFilters.set(notebook.key, item.notebook);
        }
      }
    }
    for (const tag of item.tags.filter(isVisibleGraphTag).slice(0, 4)) {
      const normalized = normalizeTag(tag);
      tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
    }
  }
  const localNoisyNotebooks = new Set(
    [...notebookCounts]
      .filter(([, count]) => count > renderedItems.length * 0.2)
      .map(([key]) => key),
  );
  const noisyNotebookKeys = options.noisyNotebookKeys ?? localNoisyNotebooks;

  for (const item of renderedItems) {
    const source = itemNodeIds.get(item.id)!;
    if (allowed.has("notebooks") && item.notebook && nodes.size < query.limit) {
      const notebook = normalizeNotebook(item.notebook);
      if (
        notebook.key &&
        !noisyNotebookKeys.has(notebook.key) &&
        (notebookCounts.get(notebook.key) ?? 0) >= 2
      ) {
        const id = hubId("notebooks", notebook.key);
        if (!nodes.has(id)) {
          nodes.set(id, {
            id,
            itemId: null,
            type: "notebooks",
            label: notebookLabels.get(notebook.key) ?? notebook.label,
            value: 12,
            hub: true,
            href: `/everything?notebook=${encodeURIComponent(notebookFilters.get(notebook.key) ?? item.notebook)}`,
          });
        }
        addEdge(source, id, "notebook");
      }
    }
    if (allowed.has("tags")) {
      const tags = item.tags
        .filter(isVisibleGraphTag)
        .map(normalizeTag)
        .filter((tag) => (tagCounts.get(tag) ?? 0) >= 2);
      for (const tag of tags.slice(0, 4)) {
        if (nodes.size >= query.limit) break;
        const id = hubId("tags", tag);
        if (!nodes.has(id)) {
          nodes.set(id, {
            id,
            itemId: null,
            type: "tags",
            label: tag,
            value: 8,
            hub: true,
            href: `/everything?tag=${encodeURIComponent(tag)}`,
          });
        }
        addEdge(source, id, "tag");
      }
    }
  }

  const byDomain = new Map<string, string[]>();
  const byUrl = new Map<string, string>();
  for (const item of itemRows) {
    const nodeId = itemNodeIds.get(item.id);
    if (!nodeId) continue;
    if (item.domain) {
      const group = byDomain.get(item.domain) ?? [];
      group.push(nodeId);
      byDomain.set(item.domain, group);
    }
    if (item.sourceUrl) byUrl.set(item.sourceUrl.replace(/#.*$/, ""), nodeId);
  }
  for (const group of byDomain.values()) {
    for (let index = 1; index < group.length; index += 1) {
      addEdge(group[index - 1]!, group[index]!, "domain");
    }
  }
  for (const item of itemRows) {
    const source = itemNodeIds.get(item.id);
    if (!source) continue;
    for (const url of externalUrls(item.bodyText)) {
      const target = byUrl.get(url.replace(/#.*$/, ""));
      if (target) addEdge(source, target, "backlink");
    }
  }

  for (const node of nodes.values()) {
    node.value += Math.min(12, edgeCounts.get(node.id) ?? 0);
  }
  return { nodes: [...nodes.values()], edges };
}

export function graphItemLimit(query: GraphQuery): number {
  return query.types.includes("tags") || query.types.includes("notebooks")
    ? Math.max(1, Math.floor(query.limit * 0.8))
    : query.limit;
}

type GraphProjectedRow = {
  id: unknown;
  kind: unknown;
  source: unknown;
  title: unknown;
  description: unknown;
  domain: unknown;
  source_url: unknown;
  body_text: unknown;
  media: unknown;
  tags: unknown;
  notebook: unknown;
  bumped_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  rn?: unknown;
  record_type?: unknown;
};

function projectedRows(result: unknown): GraphProjectedRow[] {
  const possible = result as { rows?: GraphProjectedRow[] };
  return possible.rows ?? (Array.isArray(result) ? result : []);
}

function projectedStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
}

function projectedIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function projectedItem(row: GraphProjectedRow): SavedItemDto {
  return {
    id: String(row.id),
    kind: String(row.kind ?? "note"),
    state: "ready",
    source: String(row.source ?? "recall"),
    title: String(row.title ?? "Untitled"),
    description:
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : null,
    domain:
      typeof row.domain === "string" && row.domain.trim()
        ? row.domain.trim()
        : null,
    sourceUrl:
      typeof row.source_url === "string" && row.source_url.trim()
        ? row.source_url.trim()
        : null,
    bodyText: String(row.body_text ?? ""),
    media:
      row.media && typeof row.media === "object" && !Array.isArray(row.media)
        ? row.media
        : {},
    tags: projectedStrings(row.tags),
    notebook:
      typeof row.notebook === "string" && row.notebook.trim()
        ? row.notebook.trim()
        : null,
    trashed: false,
    bumpedAt: projectedIso(row.bumped_at),
    createdAt: projectedIso(row.created_at),
    updatedAt: projectedIso(row.updated_at),
  };
}

const SOURCE_RECORD_TYPES = [
  "evernote_note",
  "gmail_message",
  "drive_file",
  "calendar_event",
  "finance_transaction",
  "flipperforce_project",
  "homey_device",
  "google_contact",
] as const;
type SourceRecordType = (typeof SOURCE_RECORD_TYPES)[number];

const SOURCE_WEIGHTS = {
  items: 8,
  notes: 12,
  evernote_note: 16,
  gmail_message: 12,
  drive_file: 9,
  calendar_event: 7,
  finance_transaction: 12,
  flipperforce_project: 3,
  homey_device: 2,
  google_contact: 5,
  memories: 9,
  tasks: 7,
} as const;
type SourceKey = keyof typeof SOURCE_WEIGHTS;

function graphSourceKeys(query: GraphQuery): SourceKey[] {
  const allowed = new Set(query.types);
  return (Object.keys(SOURCE_WEIGHTS) as SourceKey[]).filter((key) => {
    if (key === "items") {
      return ["notes", "links", "files"].some((type) =>
        allowed.has(type as GraphNodeType),
      );
    }
    if (key === "notes") return allowed.has("notes");
    const nodeType: Record<
      Exclude<SourceKey, "items" | "notes">,
      GraphNodeType
    > = {
      evernote_note: "evernote",
      gmail_message: "gmail",
      drive_file: "drive",
      calendar_event: "calendar",
      finance_transaction: "finance",
      flipperforce_project: "flipperforce",
      homey_device: "homey",
      google_contact: "contacts",
      memories: "memories",
      tasks: "tasks",
    };
    return allowed.has(nodeType[key]);
  });
}

export function sourceQuotasForQuery(
  query: GraphQuery,
): Record<SourceKey, number> {
  const budget = graphItemLimit(query);
  const active = graphSourceKeys(query);
  const totalWeight = active.reduce(
    (total, key) => total + SOURCE_WEIGHTS[key],
    0,
  );
  const quotas = Object.fromEntries(
    (Object.keys(SOURCE_WEIGHTS) as SourceKey[]).map((key) => [key, 0]),
  ) as Record<SourceKey, number>;
  if (!totalWeight) return quotas;
  const ranked = active
    .map((key) => {
      const exact = (budget * SOURCE_WEIGHTS[key]) / totalWeight;
      quotas[key] = Math.floor(exact);
      return { key, remainder: exact - Math.floor(exact) };
    })
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        SOURCE_WEIGHTS[b.key] - SOURCE_WEIGHTS[a.key],
    );
  let remaining =
    budget - active.reduce((total, key) => total + quotas[key], 0);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    quotas[ranked[index % ranked.length]!.key] += 1;
  }
  return quotas;
}

function pageOffset(query: GraphQuery, quota: number): number {
  return Math.floor(query.offset / query.limit) * quota;
}

function sourceRecordSource(recordType: SourceRecordType): string {
  switch (recordType) {
    case "evernote_note":
      return "evernote";
    case "gmail_message":
      return "gmail";
    case "drive_file":
      return "drive";
    case "calendar_event":
      return "calendar";
    case "finance_transaction":
      return "finance";
    case "flipperforce_project":
      return "flipperforce";
    case "homey_device":
      return "homey";
    case "google_contact":
      return "contact";
  }
}

async function listSourceGraphRows(
  userId: string,
  query: GraphQuery,
  recordType: SourceRecordType,
  quota: number,
): Promise<GraphProjectedRow[]> {
  if (quota <= 0) return [];
  const offset = pageOffset(query, quota);
  const search = query.q
    ? sql`sr.search_tsv @@ websearch_to_tsquery('simple', ${query.q})`
    : sql`true`;
  const result = await getDb().execute(sql`
    SELECT
      concat('source-record:', sr.id) AS id,
      sr.record_type AS kind,
      sr.record_type,
      coalesce(sr.record_title, 'Untitled') AS title,
      null::text AS description,
      null::text AS domain,
      sr.source_url,
      left(coalesce(sr.record_text, ''), ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
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
    FROM source_records sr
    JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
    WHERE sr.user_id = ${userId}::uuid
      AND sr.record_type = ${recordType}
      AND ${search}
      AND (
        sr.record_type <> 'evernote_note'
        OR lower(coalesce(
          sr.record_metadata->>'trashed',
          sr.record_metadata->>'deleted',
          'false'
        )) NOT IN ('true', '1', 'yes')
      )
    ORDER BY
      coalesce(sr.source_updated_at, sr.updated_at) DESC,
      sr.id DESC
    LIMIT ${quota + 1}
    OFFSET ${offset}
  `);
  return projectedRows(result);
}

async function listGraphRowsForUser(
  userId: string,
  query: GraphQuery,
): Promise<{ items: SavedItemDto[]; hasMore: boolean }> {
  const budget = graphItemLimit(query);
  const q = query.q;
  const quotas = sourceQuotasForQuery(query);
  const itemQuota = quotas.items;
  const noteQuota = quotas.notes;
  const memoryQuota = quotas.memories;
  const taskQuota = quotas.tasks;
  const itemOffset = pageOffset(query, itemQuota);
  const noteOffset = pageOffset(query, noteQuota);
  const memoryOffset = pageOffset(query, memoryQuota);
  const taskOffset = pageOffset(query, taskQuota);
  const itemSearch = q
    ? sql`i.search_tsv @@ websearch_to_tsquery('simple', ${q})`
    : sql`true`;
  const noteSearch = q
    ? sql`n.search_tsv @@ websearch_to_tsquery('simple', ${q})`
    : sql`true`;
  const memorySearch = q
    ? sql`to_tsvector('simple', concat_ws(E'\n', m.title, m.content, m.tags::text))
        @@ websearch_to_tsquery('simple', ${q})`
    : sql`true`;
  const taskSearch = q
    ? sql`to_tsvector('simple', concat_ws(E'\n', t.title, t.tags::text))
        @@ websearch_to_tsquery('simple', ${q})`
    : sql`true`;
  const sourceQuotas = Object.fromEntries(
    SOURCE_RECORD_TYPES.map((type) => [type, quotas[type]]),
  ) as Record<SourceRecordType, number>;

  const [itemResult, noteResult, sourceResults, memoryResult, taskResult] =
    await Promise.all([
      itemQuota > 0
        ? getDb().execute(sql`
        SELECT
          i.id, i.kind, i.source, i.title, i.description, i.domain,
          i.source_url, left(i.body_text, ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
          i.media, i.tags, i.notebook, i.bumped_at, i.created_at, i.updated_at
        FROM items i
        WHERE i.user_id = ${userId}::uuid
          AND i.deleted_at IS NULL
          AND ${itemSearch}
        ORDER BY i.bumped_at DESC, i.id DESC
        LIMIT ${itemQuota + 1}
        OFFSET ${itemOffset}
      `)
        : Promise.resolve([]),
      noteQuota > 0
        ? getDb().execute(sql`
        SELECT
          concat('note:', n.id) AS id,
          'note' AS kind,
          'recall' AS source,
          n.title,
          null::text AS description,
          null::text AS domain,
          null::text AS source_url,
          left(n.preview, ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
          '{}'::jsonb AS media,
          n.tags,
          nb.name AS notebook,
          n.updated_at AS bumped_at,
          n.created_at,
          n.updated_at
        FROM notes n
        LEFT JOIN notebooks nb ON nb.id = n.notebook_id
        WHERE n.user_id = ${userId}::uuid
          AND ${noteSearch}
          AND NOT EXISTS (
            SELECT 1
            FROM source_records twin
            JOIN connectors twin_connector ON twin_connector.id = twin.connector_id
            WHERE twin.user_id = n.user_id
              AND (twin_connector.type = 'evernote' OR twin.record_type = 'evernote_note')
              AND lower(regexp_replace(btrim(coalesce(twin.record_title, '')), '[[:space:]]+', ' ', 'g')) =
                  lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
              AND lower(coalesce(
                twin.record_metadata->>'trashed',
                twin.record_metadata->>'deleted',
                'false'
              )) NOT IN ('true', '1', 'yes')
          )
        ORDER BY n.updated_at DESC, n.id DESC
        LIMIT ${noteQuota + 1}
        OFFSET ${noteOffset}
      `)
        : Promise.resolve([]),
      Promise.all(
        SOURCE_RECORD_TYPES.map((recordType) =>
          listSourceGraphRows(
            userId,
            query,
            recordType,
            sourceQuotas[recordType],
          ),
        ),
      ),
      memoryQuota > 0
        ? getDb().execute(sql`
        SELECT
          concat('memory:', m.id) AS id,
          'memory' AS kind,
          'memory' AS source,
          m.title,
          m.summary AS description,
          null::text AS domain,
          null::text AS source_url,
          left(m.content, ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
          '{}'::jsonb AS media,
          m.tags,
          null::text AS notebook,
          m.updated_at AS bumped_at,
          m.created_at,
          m.updated_at
        FROM life_memories m
        WHERE m.user_id = ${userId}::uuid
          AND m.status = 'active'
          AND (m.expires_at IS NULL OR m.expires_at > now())
          AND ${memorySearch}
        ORDER BY m.pinned DESC, m.updated_at DESC, m.id DESC
        LIMIT ${memoryQuota + 1}
        OFFSET ${memoryOffset}
      `)
        : Promise.resolve([]),
      taskQuota > 0
        ? getDb().execute(sql`
        SELECT
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
        WHERE t.user_id = ${userId}::uuid
          AND ${taskSearch}
        ORDER BY t.completed ASC, t.updated_at DESC, t.id DESC
        LIMIT ${taskQuota + 1}
        OFFSET ${taskOffset}
      `)
        : Promise.resolve([]),
    ]);

  const hasMoreBySimpleResult = [
    [projectedRows(itemResult), itemQuota],
    [projectedRows(noteResult), noteQuota],
    [projectedRows(memoryResult), memoryQuota],
    [projectedRows(taskResult), taskQuota],
  ] as const;
  let hasMore = hasMoreBySimpleResult.some(
    ([rows, quota]) => rows.length > quota,
  );
  hasMore ||= sourceResults.some(
    (rows, index) => rows.length > sourceQuotas[SOURCE_RECORD_TYPES[index]!],
  );
  const sourceRows = sourceResults.flat();
  const keptSourceCounts = new Map<SourceRecordType, number>();
  const keptSourceRows = sourceRows.filter((row) => {
    const recordType = String(row.record_type) as SourceRecordType;
    const quota = sourceQuotas[recordType];
    const kept = keptSourceCounts.get(recordType) ?? 0;
    if (kept >= quota) {
      hasMore = true;
      return false;
    }
    keptSourceCounts.set(recordType, kept + 1);
    row.source = sourceRecordSource(recordType);
    return true;
  });

  const items = hideNativeNotesWithEvernoteTwin(
    [
      ...projectedRows(itemResult).slice(0, itemQuota),
      ...projectedRows(noteResult).slice(0, noteQuota),
      ...keptSourceRows,
      ...projectedRows(memoryResult).slice(0, memoryQuota),
      ...projectedRows(taskResult).slice(0, taskQuota),
    ].map(projectedItem),
  )
    .filter((item) => query.types.includes(itemGraphType(item)))
    .sort((a, b) => Date.parse(b.bumpedAt) - Date.parse(a.bumpedAt))
    .slice(0, budget);
  return { items, hasMore };
}

async function noisyNotebookKeysForUser(userId: string): Promise<Set<string>> {
  const result = await getDb().execute(sql`
    WITH visible_notes AS (
      SELECT nb.name AS notebook
      FROM notes n
      LEFT JOIN notebooks nb ON nb.id = n.notebook_id
      WHERE n.user_id = ${userId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM source_records twin
          JOIN connectors twin_connector ON twin_connector.id = twin.connector_id
          WHERE twin.user_id = n.user_id
            AND (twin_connector.type = 'evernote' OR twin.record_type = 'evernote_note')
            AND lower(regexp_replace(btrim(coalesce(twin.record_title, '')), '[[:space:]]+', ' ', 'g')) =
                lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
            AND lower(coalesce(
              twin.record_metadata->>'trashed',
              twin.record_metadata->>'deleted',
              'false'
            )) NOT IN ('true', '1', 'yes')
        )
      UNION ALL
      SELECT sr.record_metadata->>'notebookName' AS notebook
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id
      WHERE sr.user_id = ${userId}::uuid
        AND (c.type = 'evernote' OR sr.record_type = 'evernote_note')
        AND lower(coalesce(
          sr.record_metadata->>'trashed',
          sr.record_metadata->>'deleted',
          'false'
        )) NOT IN ('true', '1', 'yes')
    )
    SELECT notebook, count(*)::int AS count
    FROM visible_notes
    GROUP BY notebook
  `);
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of projectedRows(result)) {
    const notebook =
      typeof (row as { notebook?: unknown }).notebook === "string"
        ? String((row as { notebook: unknown }).notebook)
        : "";
    const count = Number((row as { count?: unknown }).count ?? 0);
    if (!Number.isFinite(count)) continue;
    total += count;
    const key = normalizeNotebook(notebook).key;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return new Set(
    [...counts]
      .filter(([, count]) => total > 0 && count > total * 0.2)
      .map(([key]) => key),
  );
}

export async function getKnowledgeGraphForUser(
  userId: string,
  query: GraphQuery,
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  page: { offset: number; limit: number; nextOffset: number | null };
}> {
  const [page, noisyNotebookKeys] = await Promise.all([
    listGraphRowsForUser(userId, query),
    query.types.includes("notebooks")
      ? noisyNotebookKeysForUser(userId)
      : Promise.resolve(new Set<string>()),
  ]);
  const graph = buildKnowledgeGraph(page.items, query, { noisyNotebookKeys });
  return {
    ...graph,
    page: {
      offset: query.offset,
      limit: query.limit,
      nextOffset:
        page.hasMore && query.offset + query.limit <= 1_000
          ? query.offset + query.limit
          : null,
    },
  };
}
