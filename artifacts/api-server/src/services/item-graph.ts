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

export function maskGraphLabel(value: string): string {
  return value.replace(/(?:\*{4})?\d+/g, (match) => {
    const digits = match.replace(/\*/g, "");
    return `****${digits.slice(-4)}`;
  });
}

const GRAPH_SEARCH_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "find",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "look",
  "me",
  "my",
  "note",
  "notes",
  "of",
  "on",
  "or",
  "please",
  "recall",
  "search",
  "show",
  "tell",
  "the",
  "there",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
]);

export function graphSearchTerms(value: string): string[] {
  const terms =
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter(
        (term) =>
          (term.length >= 2 || /^\d+$/.test(term)) &&
          !GRAPH_SEARCH_STOPWORDS.has(term),
      ) ?? [];
  return [...new Set(terms)].slice(0, 8);
}

export function graphSearchTsQuery(value: string): string | null {
  const terms = graphSearchTerms(value);
  return terms.length ? terms.join(" | ") : null;
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
      label: maskGraphLabel(item.title),
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
            label: maskGraphLabel(
              notebookLabels.get(notebook.key) ?? notebook.label,
            ),
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
            label: maskGraphLabel(tag),
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
  rowCounts?: Partial<Record<SourceKey, number>>,
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
  if (!rowCounts) return quotas;

  for (const key of active) {
    quotas[key] = Math.min(
      quotas[key],
      Math.max(0, Math.floor(rowCounts[key] ?? 0)),
    );
  }
  remaining = budget - active.reduce((total, key) => total + quotas[key], 0);
  const recipients = active
    .filter((key) => (rowCounts[key] ?? 0) > quotas[key])
    .sort(
      (a, b) =>
        SOURCE_WEIGHTS[b] - SOURCE_WEIGHTS[a] ||
        (rowCounts[b] ?? 0) - quotas[b] - ((rowCounts[a] ?? 0) - quotas[a]),
    );
  while (remaining > 0 && recipients.length > 0) {
    let granted = false;
    for (const key of recipients) {
      if (remaining === 0) break;
      if (quotas[key] >= (rowCounts[key] ?? 0)) continue;
      quotas[key] += 1;
      remaining -= 1;
      granted = true;
    }
    if (!granted) break;
  }
  return quotas;
}

function pageOffset(query: GraphQuery, quota: number): number {
  return Math.floor(query.offset / query.limit) * quota;
}

type GraphDb = Pick<ReturnType<typeof getDb>, "execute">;

function graphSourceTypeSql(types: SourceRecordType[]) {
  return types.length
    ? sql`sr.record_type IN (${sql.join(
        types.map((type) => sql`${type}`),
        sql`, `,
      )})`
    : sql`false`;
}

function graphItemKindSql(query: GraphQuery) {
  const allowed = new Set(query.types);
  return sql`(
    (${allowed.has("notes")} AND i.kind = 'note')
    OR (${allowed.has("links")} AND i.kind = 'link')
    OR (${allowed.has("files")} AND i.kind IN ('image', 'pdf', 'file'))
  )`;
}

async function graphRowCountsForUser(
  db: GraphDb,
  userId: string,
  query: GraphQuery,
): Promise<Record<SourceKey, number>> {
  const tsQuery = graphSearchTsQuery(query.q);
  const itemSearch = tsQuery
    ? sql`i.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const noteSearch = tsQuery
    ? sql`n.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const sourceSearch = tsQuery
    ? sql`sr.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const memorySearch = tsQuery
    ? sql`to_tsvector('simple', concat_ws(E'\n', m.title, m.content, m.tags::text))
        @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const taskSearch = tsQuery
    ? sql`to_tsvector('simple', concat_ws(E'\n', t.title, t.tags::text))
        @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const sourceTypes = SOURCE_RECORD_TYPES.filter((type) => {
    const nodeType: Record<SourceRecordType, GraphNodeType> = {
      evernote_note: "evernote",
      gmail_message: "gmail",
      drive_file: "drive",
      calendar_event: "calendar",
      finance_transaction: "finance",
      flipperforce_project: "flipperforce",
      homey_device: "homey",
      google_contact: "contacts",
    };
    return query.types.includes(nodeType[type]);
  });
  const result = await db.execute(sql`
    WITH evernote_titles AS MATERIALIZED (
      SELECT DISTINCT
        lower(regexp_replace(btrim(coalesce(sr.record_title, '')), '[[:space:]]+', ' ', 'g')) AS title_norm
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
      WHERE sr.user_id = ${userId}::uuid
        AND (c.type = 'evernote' OR sr.record_type = 'evernote_note')
        AND lower(coalesce(
          sr.record_metadata->>'trashed',
          sr.record_metadata->>'deleted',
          'false'
        )) NOT IN ('true', '1', 'yes')
        AND btrim(coalesce(sr.record_title, '')) <> ''
    )
    SELECT source_key, row_count
    FROM (
      SELECT 'items'::text AS source_key, count(*)::int AS row_count
      FROM items i
      WHERE i.user_id = ${userId}::uuid
        AND i.deleted_at IS NULL
        AND ${graphItemKindSql(query)}
        AND ${itemSearch}

      UNION ALL

      SELECT 'notes'::text AS source_key, count(*)::int AS row_count
      FROM notes n
      LEFT JOIN evernote_titles et
        ON et.title_norm =
          lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
      WHERE n.user_id = ${userId}::uuid
        AND ${query.types.includes("notes")}
        AND ${noteSearch}
        AND et.title_norm IS NULL

      UNION ALL

      SELECT sr.record_type AS source_key, count(*)::int AS row_count
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
      WHERE sr.user_id = ${userId}::uuid
        AND ${graphSourceTypeSql(sourceTypes)}
        AND ${sourceSearch}
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
      WHERE m.user_id = ${userId}::uuid
        AND ${query.types.includes("memories")}
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND ${memorySearch}

      UNION ALL

      SELECT 'tasks'::text AS source_key, count(*)::int AS row_count
      FROM tasks t
      WHERE t.user_id = ${userId}::uuid
        AND ${query.types.includes("tasks")}
        AND ${taskSearch}
    ) counts
  `);
  const counts = Object.fromEntries(
    (Object.keys(SOURCE_WEIGHTS) as SourceKey[]).map((key) => [key, 0]),
  ) as Record<SourceKey, number>;
  for (const row of projectedRows(result)) {
    const key = String(
      (row as GraphProjectedRow & { source_key?: unknown }).source_key ?? "",
    ) as SourceKey;
    if (key in counts) {
      counts[key] = Math.max(
        0,
        Number((row as GraphProjectedRow & { row_count?: unknown }).row_count),
      );
    }
  }
  return counts;
}

function sourceQuotaValues(
  query: GraphQuery,
  quotas: Record<SourceKey, number>,
) {
  return sql.join(
    (Object.keys(quotas) as SourceKey[]).map(
      (key) =>
        sql`(
          ${key}::text,
          ${pageOffset(query, quotas[key])}::int,
          ${quotas[key]}::int
        )`,
    ),
    sql`, `,
  );
}

async function listGraphRowsForUser(
  db: GraphDb,
  userId: string,
  query: GraphQuery,
): Promise<{ items: SavedItemDto[]; hasMore: boolean }> {
  const budget = graphItemLimit(query);
  const rowCounts = await graphRowCountsForUser(db, userId, query);
  const quotas = sourceQuotasForQuery(query, rowCounts);
  const tsQuery = graphSearchTsQuery(query.q);
  const itemSearch = tsQuery
    ? sql`i.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const noteSearch = tsQuery
    ? sql`n.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const memorySearch = tsQuery
    ? sql`to_tsvector('simple', concat_ws(E'\n', m.title, m.content, m.tags::text))
        @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const taskSearch = tsQuery
    ? sql`to_tsvector('simple', concat_ws(E'\n', t.title, t.tags::text))
        @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const sourceSearch = tsQuery
    ? sql`sr.search_tsv @@ to_tsquery('simple', ${tsQuery})`
    : sql`true`;
  const activeSourceTypes = SOURCE_RECORD_TYPES.filter(
    (type) => quotas[type] > 0,
  );
  const [itemResult, noteResult, sourceResult, memoryResult, taskResult] =
    await Promise.all([
      quotas.items > 0
        ? db.execute(sql`
            SELECT
              'items'::text AS source_key,
              i.id, i.kind, i.source, i.title, i.description, i.domain,
              i.source_url, left(i.body_text, ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
              i.media, i.tags, i.notebook, i.bumped_at, i.created_at, i.updated_at
            FROM items i
            WHERE i.user_id = ${userId}::uuid
              AND i.deleted_at IS NULL
              AND ${graphItemKindSql(query)}
              AND ${itemSearch}
            ORDER BY i.bumped_at DESC, i.id DESC
            LIMIT ${quotas.items + 1}
            OFFSET ${pageOffset(query, quotas.items)}
          `)
        : Promise.resolve([]),
      quotas.notes > 0
        ? db.execute(sql`
            WITH evernote_titles AS MATERIALIZED (
              SELECT DISTINCT
                lower(regexp_replace(btrim(coalesce(sr.record_title, '')), '[[:space:]]+', ' ', 'g')) AS title_norm
              FROM source_records sr
              JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
              WHERE sr.user_id = ${userId}::uuid
                AND (c.type = 'evernote' OR sr.record_type = 'evernote_note')
                AND lower(coalesce(
                  sr.record_metadata->>'trashed',
                  sr.record_metadata->>'deleted',
                  'false'
                )) NOT IN ('true', '1', 'yes')
                AND btrim(coalesce(sr.record_title, '')) <> ''
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
              left(n.preview, ${ITEM_GRAPH_BODY_MAX_CHARS}) AS body_text,
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
            WHERE n.user_id = ${userId}::uuid
              AND ${noteSearch}
              AND et.title_norm IS NULL
            ORDER BY n.updated_at DESC, n.id DESC
            LIMIT ${quotas.notes + 1}
            OFFSET ${pageOffset(query, quotas.notes)}
          `)
        : Promise.resolve([]),
      activeSourceTypes.length > 0
        ? db.execute(sql`
            WITH quota_config(source_key, row_offset, row_limit) AS (
              VALUES ${sourceQuotaValues(query, quotas)}
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
              WHERE sr.user_id = ${userId}::uuid
                AND ${graphSourceTypeSql(activeSourceTypes)}
                AND ${sourceSearch}
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
            FROM ranked_source_ids ranked
            JOIN quota_config quota ON quota.source_key = ranked.source_key
            JOIN source_records sr ON sr.id = ranked.id
            WHERE quota.row_limit > 0
              AND ranked.rn > quota.row_offset
              AND ranked.rn <= quota.row_offset + quota.row_limit + 1
            ORDER BY bumped_at DESC, id DESC
          `)
        : Promise.resolve([]),
      quotas.memories > 0
        ? db.execute(sql`
            SELECT
              'memories'::text AS source_key,
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
            LIMIT ${quotas.memories + 1}
            OFFSET ${pageOffset(query, quotas.memories)}
          `)
        : Promise.resolve([]),
      quotas.tasks > 0
        ? db.execute(sql`
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
            WHERE t.user_id = ${userId}::uuid
              AND ${taskSearch}
            ORDER BY t.completed ASC, t.updated_at DESC, t.id DESC
            LIMIT ${quotas.tasks + 1}
            OFFSET ${pageOffset(query, quotas.tasks)}
          `)
        : Promise.resolve([]),
    ]);

  const fetchedRows = [
    ...projectedRows(itemResult),
    ...projectedRows(noteResult),
    ...projectedRows(sourceResult),
    ...projectedRows(memoryResult),
    ...projectedRows(taskResult),
  ];
  const keptCounts = new Map<SourceKey, number>();
  let hasMore = false;
  const keptRows = fetchedRows.filter((row) => {
    const key = String(
      (row as GraphProjectedRow & { source_key?: unknown }).source_key ?? "",
    ) as SourceKey;
    const quota = quotas[key] ?? 0;
    const kept = keptCounts.get(key) ?? 0;
    if (kept >= quota) {
      hasMore = true;
      return false;
    }
    keptCounts.set(key, kept + 1);
    return true;
  });
  const items = hideNativeNotesWithEvernoteTwin(keptRows.map(projectedItem))
    .filter((item) => query.types.includes(itemGraphType(item)))
    .sort((a, b) => Date.parse(b.bumpedAt) - Date.parse(a.bumpedAt))
    .slice(0, budget);
  return { items, hasMore };
}

const NOISY_NOTEBOOK_CACHE_TTL_MS = 30_000;
const NOISY_NOTEBOOK_CACHE_MAX_USERS = 100;
const noisyNotebookCache = new Map<
  string,
  { expiresAt: number; keys: ReadonlySet<string> }
>();

export function clearGraphCachesForTest(): void {
  noisyNotebookCache.clear();
}

async function noisyNotebookKeysForUser(
  db: GraphDb,
  userId: string,
): Promise<ReadonlySet<string>> {
  const cached = noisyNotebookCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  noisyNotebookCache.delete(userId);
  const result = await db.execute(sql`
    WITH evernote_titles AS MATERIALIZED (
      SELECT DISTINCT
        lower(regexp_replace(btrim(coalesce(sr.record_title, '')), '[[:space:]]+', ' ', 'g')) AS title_norm
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
      WHERE sr.user_id = ${userId}::uuid
        AND (c.type = 'evernote' OR sr.record_type = 'evernote_note')
        AND lower(coalesce(
          sr.record_metadata->>'trashed',
          sr.record_metadata->>'deleted',
          'false'
        )) NOT IN ('true', '1', 'yes')
        AND btrim(coalesce(sr.record_title, '')) <> ''
    ),
    visible_notes AS (
      SELECT nb.name AS notebook
      FROM notes n
      LEFT JOIN notebooks nb ON nb.id = n.notebook_id
      LEFT JOIN evernote_titles et
        ON et.title_norm =
          lower(regexp_replace(btrim(coalesce(n.title, '')), '[[:space:]]+', ' ', 'g'))
      WHERE n.user_id = ${userId}::uuid
        AND et.title_norm IS NULL
      UNION ALL
      SELECT sr.record_metadata->>'notebookName' AS notebook
      FROM source_records sr
      JOIN connectors c ON c.id = sr.connector_id AND c.enabled = true
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
  const keys = new Set(
    [...counts]
      .filter(([, count]) => total > 0 && count > total * 0.2)
      .map(([key]) => key),
  );
  if (noisyNotebookCache.size >= NOISY_NOTEBOOK_CACHE_MAX_USERS) {
    noisyNotebookCache.delete(noisyNotebookCache.keys().next().value ?? "");
  }
  noisyNotebookCache.set(userId, {
    expiresAt: Date.now() + NOISY_NOTEBOOK_CACHE_TTL_MS,
    keys,
  });
  return keys;
}

export async function getKnowledgeGraphForUser(
  userId: string,
  query: GraphQuery,
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  page: { offset: number; limit: number; nextOffset: number | null };
}> {
  const { page, noisyNotebookKeys } = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
    );
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const page = await listGraphRowsForUser(tx, userId, query);
    const noisyNotebookKeys = query.types.includes("notebooks")
      ? await noisyNotebookKeysForUser(tx, userId)
      : new Set<string>();
    return { page, noisyNotebookKeys };
  });
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
