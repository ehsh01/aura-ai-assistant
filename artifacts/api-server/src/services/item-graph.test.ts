import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraph,
  graphSearchTsQuery,
  hideNativeNotesWithEvernoteTwin,
  maskGraphLabel,
  parseGraphQuery,
  sourceQuotasForQuery,
  type GraphQuery,
  type GraphNodeType,
} from "./item-graph";
import type { SavedItemDto } from "./items";

const GRAPH_SOURCE_TYPES: GraphNodeType[] = [
  "notes",
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
];

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

function graphQuery(overrides: Partial<GraphQuery> = {}): GraphQuery {
  return {
    q: "",
    limit: 20,
    offset: 0,
    types: ["notes", "notebooks", "tags", "links", "files", "evernote"],
    maxEdgesPerNode: 8,
    maxEdgesPerHub: 200,
    ...overrides,
  };
}

describe("knowledge graph caps and filters", () => {
  it("caps a realistic 5,000-item corpus, edge fanout, limit, and offset", () => {
    const query = parseGraphQuery({
      q: "oil change",
      limit: "9999",
      offset: "-4",
    });
    expect(query).toMatchObject({
      q: "oil change",
      limit: 500,
      offset: 0,
      maxEdgesPerNode: 8,
      maxEdgesPerHub: 200,
    });
    expect(parseGraphQuery({ limit: "500", offset: "9999" }).offset).toBe(
      1_000,
    );

    const graph = buildKnowledgeGraph(
      Array.from({ length: 5_000 }, (_, index) => item(String(index))),
      query,
    );
    expect(graph.nodes.length).toBeLessThanOrEqual(500);
    expect(graph.nodes.filter((node) => node.itemId)).toHaveLength(400);
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

  it("allocates the bounded item budget only across requested sources", () => {
    const all = sourceQuotasForQuery(graphQuery({ limit: 350 }));
    expect(Object.values(all).reduce((sum, value) => sum + value, 0)).toBe(280);

    const tiny = sourceQuotasForQuery(
      graphQuery({ limit: 1, types: ["gmail"] }),
    );
    expect(tiny.gmail_message).toBe(1);
    expect(Object.values(tiny).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(tiny.evernote_note).toBe(0);
    expect(tiny.items).toBe(0);
  });

  it("returns unused source shares to sources that have rows", () => {
    const query = graphQuery({
      limit: 350,
      types: [...GRAPH_SOURCE_TYPES, "notebooks", "tags"],
    });
    const counts = Object.fromEntries(
      Object.keys(sourceQuotasForQuery(query)).map((key) => [key, 0]),
    );
    Object.assign(counts, {
      evernote_note: 4_927,
      notes: 31,
      gmail_message: 393,
      drive_file: 150,
      finance_transaction: 3_261,
      flipperforce_project: 2,
      homey_device: 1,
      memories: 224,
      tasks: 18,
      google_contact: 213,
    });
    const quotas = sourceQuotasForQuery(query, counts);
    expect(Object.values(quotas).reduce((sum, value) => sum + value, 0)).toBe(
      280,
    );
    expect(quotas.flipperforce_project).toBe(2);
    expect(quotas.homey_device).toBe(1);
    expect(quotas.evernote_note).toBeGreaterThan(43);
  });

  it("uses deterministic any-word terms for graph search", () => {
    expect(
      graphSearchTsQuery(
        "When does my Psychiatry website registration expire?",
      ),
    ).toBe("psychiatry | website | registration | expire");
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
      graphQuery({ types }),
    );
    expect(graph.nodes.map((node) => node.type).sort()).toEqual([
      "evernote",
      "links",
    ]);
    expect(graph.nodes.every((node) => types.includes(node.type))).toBe(true);
  });

  it("does not create empty hubs when item node types are filtered out", () => {
    const graph = buildKnowledgeGraph(
      [item("one"), item("two", { notebook: "Work", tags: ["planning"] })],
      graphQuery({ types: ["notebooks", "tags"] }),
    );
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("keeps same-name notebook and tag hubs distinct for typed labels", () => {
    const graph = buildKnowledgeGraph(
      [
        item("vehicle-1", { notebook: "Vehicles", tags: ["vehicles"] }),
        item("vehicle-2", { notebook: "Vehicles", tags: ["vehicles"] }),
      ],
      graphQuery({ types: ["notes", "evernote", "notebooks", "tags"] }),
      { noisyNotebookKeys: new Set() },
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
        item("visible", {
          source: "evernote",
          notebook: "Other",
          tags: ["real tag"],
        }),
      ],
      graphQuery({ types: ["notes", "evernote", "notebooks", "tags"] }),
    );
    const tagLabels = graph.nodes
      .filter((node) => node.type === "tags")
      .map((node) => node.label);
    expect(tagLabels).toEqual(["real tag"]);
  });

  it.each([350, 180] as const)(
    "connects the real notebook distribution at limit %i",
    (limit) => {
      const graph = buildKnowledgeGraph(
        realDistributionItems(limit),
        graphQuery({ limit }),
      );
      const connectivity = graphConnectivity(graph);
      console.info(`[graph-connectivity:${limit}]`, connectivity);

      expect(connectivity.itemNodes).toBe(Math.floor(limit * 0.8));
      expect(connectivity.zeroEdgeItems).toBeGreaterThan(3);

      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      const notebookEdges = graph.edges.filter(
        (edge) => edge.signal === "notebook",
      );
      expect(notebookEdges.length).toBeLessThan(connectivity.itemNodes - 3);
      expect(
        notebookEdges.every(
          (edge) =>
            Boolean(nodeById.get(edge.source)?.itemId) &&
            nodeById.get(edge.target)?.type === "notebooks",
        ),
      ).toBe(true);
    },
  );

  it("maps bounded connector, memory, and task rows to distinct node types", () => {
    const sources = [
      ["gmail", "gmail"],
      ["drive", "drive"],
      ["calendar", "calendar"],
      ["finance", "finance"],
      ["flipperforce", "flipperforce"],
      ["homey", "homey"],
      ["memory", "memories"],
      ["task", "tasks"],
      ["contact", "contacts"],
    ] as const;
    const graph = buildKnowledgeGraph(
      sources.map(([source], index) =>
        item(`source-${index}`, { source, tags: [], notebook: null }),
      ),
      graphQuery({
        limit: 30,
        types: sources.map(([, type]) => type),
      }),
    );
    expect(graph.nodes.map((node) => node.type).sort()).toEqual(
      sources.map(([, type]) => type).sort(),
    );
  });

  it("masks every digit run in labels for every graph source and hub", () => {
    expect(maskGraphLabel("Policy 12 / account 12345678")).toBe(
      "Policy ****12 / account ****5678",
    );
    expect(maskGraphLabel("Policy ****5678")).toBe("Policy ****5678");
    const sources = [
      "recall",
      "evernote",
      "gmail",
      "drive",
      "calendar",
      "finance",
      "flipperforce",
      "homey",
      "memory",
      "task",
      "contact",
    ];
    const graph = buildKnowledgeGraph(
      sources.flatMap((source, index) => [
        item(`${source}-a`, {
          source,
          title: `${source} account ${index + 1} 12345678`,
          notebook: "Garage 2026",
          tags: ["policy 987654"],
        }),
        item(`${source}-b`, {
          source,
          title: `${source} invoice 42`,
          notebook: "Garage 2026",
          tags: ["policy 987654"],
        }),
      ]),
      graphQuery({
        limit: 100,
        types: [...GRAPH_SOURCE_TYPES, "notebooks", "tags"],
      }),
      { noisyNotebookKeys: new Set() },
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(
      graph.nodes.every(
        (node) => !/\d/.test(node.label.replace(/\*{4}\d{1,4}/g, "")),
      ),
    ).toBe(true);
    expect(graph.nodes.some((node) => node.label.includes("****5678"))).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.label.includes("****2026"))).toBe(
      true,
    );
  });

  it("hides only native note projections with an Evernote title twin", () => {
    const rows = [
      item("note:native-twin", { title: "  Roof   Warranty " }),
      item("note:native-only", { title: "Native only" }),
      item("saved-item", { title: "Roof Warranty" }),
      item("evernote", {
        source: "evernote",
        title: "roof warranty",
      }),
    ];
    expect(hideNativeNotesWithEvernoteTwin(rows).map((row) => row.id)).toEqual([
      "note:native-only",
      "saved-item",
      "evernote",
    ]);
    expect(rows).toHaveLength(4);
  });

  it("normalizes useful hubs and removes mega, singleton, and facet hubs", () => {
    const graph = buildKnowledgeGraph(
      [
        item("one", {
          notebook: "New House (Space: Home)",
          tags: ["Home", "person:Ernesto"],
        }),
        item("two", {
          notebook: "New-House",
          tags: ["home", "date:2026-10"],
        }),
        item("three", { notebook: "Everything", tags: ["one-off"] }),
        item("four", { notebook: "Everything", tags: [] }),
        item("five", { notebook: "Everything", tags: [] }),
      ],
      graphQuery({ limit: 30 }),
      { noisyNotebookKeys: new Set(["everything"]) },
    );
    expect(
      graph.nodes
        .filter((node) => node.type === "notebooks")
        .map((node) => node.label),
    ).toEqual(["New House"]);
    expect(
      graph.nodes
        .filter((node) => node.type === "tags")
        .map((node) => node.label),
    ).toEqual(["home"]);
  });

  it("does not create hubs from rows beyond the rendered item budget", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      item(String(index), {
        notebook: index < 8 ? null : "Hidden notebook",
        tags: index < 8 ? [] : ["hidden"],
      }),
    );
    const graph = buildKnowledgeGraph(rows, graphQuery({ limit: 10 }));
    expect(graph.nodes.filter((node) => node.hub)).toHaveLength(0);
  });

  it("caps notebook hubs at the explicit hub fanout", () => {
    const graph = buildKnowledgeGraph(
      Array.from({ length: 20 }, (_, index) =>
        item(String(index), { notebook: "Project", tags: [] }),
      ),
      graphQuery({ limit: 30, maxEdgesPerHub: 5 }),
      { noisyNotebookKeys: new Set() },
    );
    expect(
      graph.edges.filter((edge) => edge.signal === "notebook"),
    ).toHaveLength(5);
  });
});
