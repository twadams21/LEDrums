/* Freeform node-wiring validation — the connect / reconnect guards (direction, duplicate,
   cycle) as PURE predicates over a TriggerGraph (no runes/DOM). The store's `connect` /
   `reconnect` consult these, then push / repoint the edge on the live `$state` graph.
   Extracted from store.svelte.ts unchanged in behaviour. */

import { type TriggerGraph, nodeHasInput, nodeHasOutput } from '../sim';

/** Can node `targetId` reach node `startId` by following edges from `startId`? (cycle test). */
export function reaches(graph: TriggerGraph, startId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === targetId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of graph.edges) if (e.from === cur) stack.push(e.to);
  }
  return false;
}

/** Whether a new wire `fromId →(fromPort) toId` is legal: distinct endpoints, both nodes
    exist, source has an output + target has an input, not a duplicate (same source-port →
    target), and would not form a cycle. Mirrors the old inline checks in `connect`. */
export function canConnect(graph: TriggerGraph, fromId: string, toId: string, fromPort?: string): boolean {
  if (fromId === toId) return false;
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !nodeHasOutput(from.kind) || !nodeHasInput(to.kind)) return false;
  // dup is per source-port: two different bands MAY route to the same child, but the same
  // (source-port → target) wire is rejected.
  if (graph.edges.some((e) => e.from === fromId && e.to === toId && (e.fromPort ?? null) === (fromPort ?? null))) {
    return false;
  }
  return !reaches(graph, toId, fromId);
}

/** Whether moving edge `edgeId` to `fromId →(fromPort) toId` is legal — same checks as
    {@link canConnect} but IGNORING the edge being moved (so its own presence never trips the
    dup / cycle guard). A false result means the drag should snap back, not delete the wire. */
export function canReconnect(
  graph: TriggerGraph,
  edgeId: string,
  fromId: string,
  toId: string,
  fromPort?: string,
): boolean {
  if (fromId === toId) return false;
  if (!graph.edges.some((e) => e.id === edgeId)) return false;
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !nodeHasOutput(from.kind) || !nodeHasInput(to.kind)) return false;
  if (
    graph.edges.some(
      (e) => e.id !== edgeId && e.from === fromId && e.to === toId && (e.fromPort ?? null) === (fromPort ?? null),
    )
  ) {
    return false; // dup
  }
  // cycle check over the graph WITHOUT the edge being moved
  return !reaches({ nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== edgeId) }, toId, fromId);
}
