import { createHash } from "node:crypto";
import {
  ITEM_GRAPH_BODY_MAX_CHARS,
  listItemsForUser,
  parseItemSearchFilters,
  type SavedItemDto,
} from "./items";
import { isVisibleItemTag } from "./item-tags";

export const GRAPH_NODE_TYPES = [
  "notes",
  "notebooks",
  "tags",
  "links",
  "files",
  "evernote",
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
  limit: number;
  offset: number;
  types: GraphNodeType[];
  maxEdgesPerNode: number;
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
    // 500 keeps the 2D simulation smooth and query work bounded. Paging exposes more.
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500)
      : 350,
    offset: Number.isFinite(requestedOffset)
      ? Math.min(Math.max(Math.floor(requestedOffset), 0), 1_000)
      : 0,
    types: rawTypes.length ? [...new Set(rawTypes)] : [...GRAPH_NODE_TYPES],
    maxEdgesPerNode: 8,
  };
}

function itemGraphType(item: SavedItemDto): GraphNodeType {
  if (item.source === "evernote") return "evernote";
  if (item.kind === "link") return "links";
  if (["image", "pdf", "file"].includes(item.kind)) return "files";
  return "notes";
}

function hubId(type: "tags" | "notebooks", value: string): string {
  return `${type}:${createHash("sha1").update(value.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function externalUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)]
    .map((match) => match[0].replace(/[.,;!?]+$/, ""))
    .slice(0, 20);
}

export function buildKnowledgeGraph(
  itemRows: SavedItemDto[],
  query: GraphQuery,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const allowed = new Set(query.types);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeCounts = new Map<string, number>();
  const itemNodeIds = new Map<string, string>();
  const itemNodeLimit =
    allowed.has("tags") || allowed.has("notebooks")
      ? Math.floor(query.limit * 0.8)
      : query.limit;

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
    if (
      sourceNode.type !== "notebooks" &&
      (edgeCounts.get(source) ?? 0) >= query.maxEdgesPerNode
    ) {
      return;
    }
    if (
      targetNode.type !== "notebooks" &&
      (edgeCounts.get(target) ?? 0) >= query.maxEdgesPerNode
    ) {
      return;
    }
    const id = [source, target].sort().join("~");
    if (edges.some((edge) => edge.id === id)) return;
    edges.push({ id, source, target, signal });
    edgeCounts.set(source, (edgeCounts.get(source) ?? 0) + 1);
    edgeCounts.set(target, (edgeCounts.get(target) ?? 0) + 1);
  };

  for (const item of itemRows) {
    const source = itemNodeIds.get(item.id);
    if (allowed.has("notebooks") && item.notebook && nodes.size < query.limit) {
      const id = hubId("notebooks", item.notebook);
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          itemId: null,
          type: "notebooks",
          label: item.notebook,
          value: 12,
          hub: true,
          href: `/everything?notebook=${encodeURIComponent(item.notebook)}`,
        });
      }
      if (source) addEdge(source, id, "notebook");
    }
    if (allowed.has("tags")) {
      const tags =
        item.source === "evernote"
          ? item.tags.filter(isVisibleItemTag)
          : item.tags;
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
        if (source) addEdge(source, id, "tag");
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

export async function getKnowledgeGraphForUser(
  userId: string,
  query: GraphQuery,
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  page: { offset: number; limit: number; nextOffset: number | null };
}> {
  // Page through at most the 1,500 freshest source items. Each response still
  // contains no more than 500 rendered nodes, keeping DB and client work bounded.
  const fetchLimit = Math.min(1_501, query.limit + query.offset + 1);
  const rows = await listItemsForUser(userId, {
    ...parseItemSearchFilters({ limit: fetchLimit }),
    limit: fetchLimit,
    bodyTextLimit: ITEM_GRAPH_BODY_MAX_CHARS,
  });
  const pageRows = rows.slice(query.offset, query.offset + query.limit);
  const graph = buildKnowledgeGraph(pageRows, query);
  return {
    ...graph,
    page: {
      offset: query.offset,
      limit: query.limit,
      nextOffset:
        rows.length > query.offset + pageRows.length &&
        query.offset + pageRows.length < 1_500
          ? query.offset + pageRows.length
          : null,
    },
  };
}
