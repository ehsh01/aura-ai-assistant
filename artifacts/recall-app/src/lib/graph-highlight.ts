export type GraphHighlightLookup = Map<string, Set<string>>;

export function buildGraphHighlightLookup(
  edges: ReadonlyArray<{ source: string; target: string }>,
): GraphHighlightLookup {
  const lookup: GraphHighlightLookup = new Map();
  for (const edge of edges) {
    let sourceNeighbors = lookup.get(edge.source);
    if (!sourceNeighbors) {
      sourceNeighbors = new Set();
      lookup.set(edge.source, sourceNeighbors);
    }
    sourceNeighbors.add(edge.target);

    let targetNeighbors = lookup.get(edge.target);
    if (!targetNeighbors) {
      targetNeighbors = new Set();
      lookup.set(edge.target, targetNeighbors);
    }
    targetNeighbors.add(edge.source);
  }
  return lookup;
}

export function isHighlightedEdge(
  sourceId: string,
  targetId: string,
  activeNodeId: string | null,
): boolean {
  return Boolean(
    activeNodeId && (sourceId === activeNodeId || targetId === activeNodeId),
  );
}

export function graphNodeOpacity(
  nodeId: string,
  activeNodeId: string | null,
  neighbors: ReadonlySet<string> | undefined,
): number {
  if (!activeNodeId) return 1;
  return nodeId === activeNodeId || neighbors?.has(nodeId) ? 1 : 0.18;
}
