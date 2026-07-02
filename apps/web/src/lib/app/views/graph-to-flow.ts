/* Pure converter between the store's TriggerGraph and the @xyflow/svelte arrays the
   Trigger Graph view renders. Kept free of Svelte/DOM so the mapping is unit-tested
   and the view stays thin (mirrors the patch-topology / show-builder split).

   Each flow node carries `type: 'trigger'` (→ TriggerNode), its world position from
   the store node's x/y, and just its `kind` in `data` — the node looks up its live
   model from the store by id, so nothing else needs snapshotting here. Nodes are
   marked `deletable: false`: removal is an Inspector action (the trigger root can
   never go), so the canvas Delete key only ever removes wires. Edges use the custom
   `wire` type so their ends are reconnectable. */

import type { Edge, Node } from '@xyflow/svelte';
import type { GraphNode, NodeKind, TriggerGraph } from '../../trigger-lab/sim';

export type TriggerNodeData = { kind: NodeKind };
export type TriggerFlowNode = Node<TriggerNodeData>;
export type TriggerFlowEdge = Edge;

/** Map the store graph's nodes to xyflow nodes (position from x/y, kind in data). */
export function graphToFlowNodes(graph: TriggerGraph): TriggerFlowNode[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'trigger',
    position: { x: n.x, y: n.y },
    deletable: false,
    data: { kind: n.kind },
  }));
}

/** Map the store graph's edges to xyflow edges (from→source, to→target). An edge's
    `fromPort` becomes the xyflow `sourceHandle` (a value+bands switch's `band-${i}`) and its
    `toPort` the `targetHandle` (`'mod'` for a modifier-chain wire); undefined leaves each on
    the node's default handle. `data.mod` flags a modifier wire so it can be styled distinctly
    (graph-hover combines it with the hover-highlight class). */
export function graphToFlowEdges(graph: TriggerGraph): TriggerFlowEdge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    sourceHandle: e.fromPort,
    targetHandle: e.toPort,
    type: 'wire',
    ...(e.toPort === 'mod' ? { data: { mod: true } } : {}),
  }));
}

/** Both arrays at once. */
export function graphToFlow(graph: TriggerGraph): {
  nodes: TriggerFlowNode[];
  edges: TriggerFlowEdge[];
} {
  return { nodes: graphToFlowNodes(graph), edges: graphToFlowEdges(graph) };
}

/** Apply xyflow node positions back onto a graph (pure; the round-trip / drag write-
    back). Unknown ids are ignored; missing nodes keep their position. */
export function applyFlowPositions(
  graph: TriggerGraph,
  flowNodes: ReadonlyArray<Pick<TriggerFlowNode, 'id' | 'position'>>,
): TriggerGraph {
  const pos = new Map(flowNodes.map((n) => [n.id, n.position]));
  return {
    nodes: graph.nodes.map((n): GraphNode => {
      const p = pos.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }),
    edges: graph.edges,
  };
}
