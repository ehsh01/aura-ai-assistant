import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraph,
  parseGraphQuery,
  type GraphNodeType,
} from "./item-graph";
import type { SavedItemDto } from "./items";

function item(id: string, overrides: Partial<SavedItemDto> = {}): SavedItemDto {
  return {
    id,
    kind: "note",
    state: "ready",
    source: "recall",
    title: `Item ${id}`,
    description: null,
    domain: null,
    sourceUrl: null,
    bodyText: "",
    media: {},
    tags: ["shared", `tag-${id}`],
    notebook: "Research",
    trashed: false,
    bumpedAt: "2026-10-17T12:00:00.000Z",
    createdAt: "2026-10-17T12:00:00.000Z",
    updatedAt: "2026-10-17T12:00:00.000Z",
    ...overrides,
  };
}

function realDistributionItems(limit: 350 | 180): SavedItemDto[] {
  const visibleItems = Math.floor(limit * 0.8);
  const dominantNotebookItems = Math.floor(limit * 0.7);
  return Array.from({ length: limit }, (_, index) => {
    const lacksInputs = index >= visibleItems - 3 && index < visibleItems;
    return item(String(index), {
      source: "evernote",
      notebook: lacksInputs
        ? null
        : index < dominantNotebookItems
          ? "Everything"
          : `Notebook ${index % 10}`,
      tags: lacksInputs || index % 29 !== 0 ? [] : [`one-off-${index}`],
    });
  });
}

function graphConnectivity(graph: ReturnType<typeof buildKnowledgeGraph>): {
  itemNodes: number;
  edges: number;
  zeroEdgeItems: number;
} {
  const itemNodeIds = new Set(
    graph.nodes.filter((node) => node.itemId).map((node) => node.id),
  );
  for (const edge of graph.edges) {
    itemNodeIds.delete(edge.source);
    itemNodeIds.delete(edge.target);
  }
  return {
    itemNodes: graph.nodes.filter((node) => node.itemId).length,
    edges: graph.edges.length,
    zeroEdgeItems: itemNodeIds.size,
  };
}

describe("knowledge graph caps and filters", () => {
  it("caps a realistic 5,000-item corpus, edge fanout, limit, and offset", () => {
    const query = parseGraphQuery({ limit: "9999", offset: "-4" });
    expect(query).toMatchObject({ limit: 500, offset: 0, maxEdgesPerNode: 8 });
    expect(parseGraphQuery({ limit: "500", offset: "9999" }).offset).toBe(
      1_000,
    );

    const graph = buildKnowledgeGraph(
      Array.from({ length: 5_000 }, (_, index) => item(String(index))),
      query,
    );
    expect(graph.nodes).toHaveLength(500);
    const degree = new Map<string, number>();
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const [nodeId, count] of degree) {
      if (nodeById.get(nodeId)?.type === "notebooks") {
        expect(count).toBeGreaterThan(8);
      } else {
        expect(count).toBeLessThanOrEqual(8);
      }
    }
  });

  it("returns only requested node types", () => {
    const types: GraphNodeType[] = ["links", "evernote"];
    const graph = buildKnowledgeGraph(
      [
        item("note"),
        item("link", { kind: "link", domain: "example.com" }),
        item("file", { kind: "image" }),
        item("evernote", { source: "evernote" }),
      ],
      { limit: 20, offset: 0, types, maxEdgesPerNode: 8 },
    );
    expect(graph.nodes.map((node) => node.type).sort()).toEqual([
      "evernote",
      "links",
    ]);
    expect(graph.nodes.every((node) => types.includes(node.type))).toBe(true);
  });

  it("keeps hub-only filters useful without requiring item node types", () => {
    const graph = buildKnowledgeGraph(
      [item("one"), item("two", { notebook: "Work", tags: ["planning"] })],
      {
        limit: 20,
        offset: 0,
        types: ["notebooks", "tags"],
        maxEdgesPerNode: 8,
      },
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(
      graph.nodes.every(
        (node) => node.type === "notebooks" || node.type === "tags",
      ),
    ).toBe(true);
  });

  it("keeps same-name notebook and tag hubs distinct for typed labels", () => {
    const graph = buildKnowledgeGraph(
      [item("vehicle", { notebook: "Vehicles", tags: ["vehicles"] })],
      {
        limit: 20,
        offset: 0,
        types: ["notes", "notebooks", "tags"],
        maxEdgesPerNode: 8,
      },
    );
    const vehicles = graph.nodes.filter(
      (node) => node.label.toLowerCase() === "vehicles",
    );

    expect(vehicles.map((node) => node.type).sort()).toEqual([
      "notebooks",
      "tags",
    ]);
    expect(new Set(vehicles.map((node) => node.id)).size).toBe(2);
  });

  it("does not render internal notebook and year facets as tag nodes", () => {
    const graph = buildKnowledgeGraph(
      [
        item("facets", {
          source: "evernote",
          tags: [
            "real tag",
            "notebook:cf240195-dcdb-486a-8ab5-example",
            "year:2026",
          ],
        }),
      ],
      {
        limit: 20,
        offset: 0,
        types: ["notes", "notebooks", "tags"],
        maxEdgesPerNode: 8,
      },
    );
    const tagLabels = graph.nodes
      .filter((node) => node.type === "tags")
      .map((node) => node.label);
    expect(tagLabels).toEqual(["real tag"]);
  });

  it.each([350, 180] as const)(
    "connects the real notebook distribution at limit %i",
    (limit) => {
      const graph = buildKnowledgeGraph(realDistributionItems(limit), {
        limit,
        offset: 0,
        types: ["notes", "notebooks", "tags", "links", "files", "evernote"],
        maxEdgesPerNode: 8,
      });
      const connectivity = graphConnectivity(graph);
      console.info(`[graph-connectivity:${limit}]`, connectivity);

      expect(connectivity.itemNodes).toBe(Math.floor(limit * 0.8));
      expect(connectivity.zeroEdgeItems).toBe(3);

      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      const notebookEdges = graph.edges.filter(
        (edge) => edge.signal === "notebook",
      );
      expect(notebookEdges).toHaveLength(connectivity.itemNodes - 3);
      expect(
        notebookEdges.every(
          (edge) =>
            Boolean(nodeById.get(edge.source)?.itemId) &&
            nodeById.get(edge.target)?.type === "notebooks",
        ),
      ).toBe(true);
    },
  );
});
