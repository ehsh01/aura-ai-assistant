import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraph,
  parseGraphQuery,
  type GraphNodeType,
} from "./item-graph";
import type { SavedItemDto } from "./items";

function item(
  id: string,
  overrides: Partial<SavedItemDto> = {},
): SavedItemDto {
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

describe("knowledge graph caps and filters", () => {
  it("caps nodes, edge fanout, limit, and offset", () => {
    const query = parseGraphQuery({ limit: "9999", offset: "-4" });
    expect(query).toMatchObject({ limit: 500, offset: 0, maxEdgesPerNode: 8 });

    const graph = buildKnowledgeGraph(
      Array.from({ length: 700 }, (_, index) => item(String(index))),
      query,
    );
    expect(graph.nodes.length).toBeLessThanOrEqual(500);
    const degree = new Map<string, number>();
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    expect(Math.max(0, ...degree.values())).toBeLessThanOrEqual(8);
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
    expect(graph.nodes.map((node) => node.type).sort()).toEqual(["evernote", "links"]);
    expect(graph.nodes.every((node) => types.includes(node.type))).toBe(true);
  });

  it("keeps hub-only filters useful without requiring item node types", () => {
    const graph = buildKnowledgeGraph(
      [item("one"), item("two", { notebook: "Work", tags: ["planning"] })],
      { limit: 20, offset: 0, types: ["notebooks", "tags"], maxEdgesPerNode: 8 },
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(
      graph.nodes.every((node) => node.type === "notebooks" || node.type === "tags"),
    ).toBe(true);
  });
});
