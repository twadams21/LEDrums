import type { GraphNode, TriggerGraph } from '../../trigger-lab/sim';
import { graphToFlowNodes, type TriggerFlowNode } from './graph-to-flow';

export type TriggerProjectionCache = {
  graphKey: string | null;
  nodeSigs: Map<string, string>;
};

export function triggerNodeSignature(n: GraphNode): string {
  return n.kind === 'switch'
    ? `${n.id}:switch:${n.on}:${n.valueMode}:${n.bands?.length ?? 0}`
    : `${n.id}:${n.kind}`;
}

export function emptyTriggerProjectionCache(): TriggerProjectionCache {
  return { graphKey: null, nodeSigs: new Map<string, string>() };
}

/** Deliberate reset of the projection cache to the empty sentinel — used on graph-open and
    on any projection/editor error path, so the NEXT projection can never reuse a previous
    graph's stale signatures (incident 09, candidate 1: a throw between projection start and
    the successful cache write-through leaves cache and rendered nodes disagreeing, which
    every later projection then rebuilds against). Semantically distinct from
    {@link emptyTriggerProjectionCache} (the initial value) though structurally identical. */
export function resetProjectionCache(): TriggerProjectionCache {
  return emptyTriggerProjectionCache();
}

/** Dev diagnostic: rendered flow-node ids that no longer exist in the store graph — the
    telemetry that convicts a projection-cache desync (incident 09, candidates 1 vs 3). An
    empty result means the rendered nodes and the store graph agree. Pure so it is unit-tested
    directly and callable from a dev-mode assertion without a live component. */
export function projectionDesyncIds(
  flowNodeIds: Iterable<string>,
  graphNodeIds: Iterable<string>,
): string[] {
  const present = new Set(graphNodeIds);
  return [...flowNodeIds].filter((id) => !present.has(id));
}

export function projectTriggerFlowNodes(args: {
  graph: TriggerGraph | null;
  graphKey: string | null;
  selectedNodeId: string | null;
  previousNodes: TriggerFlowNode[];
  cache: TriggerProjectionCache;
}): { nodes: TriggerFlowNode[]; cache: TriggerProjectionCache } {
  const { graph, graphKey, selectedNodeId, previousNodes, cache } = args;
  if (!graph) return { nodes: [], cache: emptyTriggerProjectionCache() };

  const sameGraph = graphKey === cache.graphKey;
  const prevById = sameGraph ? new Map(previousNodes.map((n) => [n.id, n])) : new Map<string, TriggerFlowNode>();
  const nodes = graphToFlowNodes(graph).map((fn, i) => {
    const sn = graph.nodes[i]!;
    const sig = triggerNodeSignature(sn);
    const wantSel = fn.id === selectedNodeId;
    const prev = prevById.get(fn.id);
    if (prev && cache.nodeSigs.get(fn.id) === sig) {
      // Structure unchanged: keep the existing flow-node object (xyflow's measured
      // handleBounds + live position). A selection-only change clones the PREVIOUS node —
      // never the fresh store projection — so selecting/deselecting a node can't snap it
      // back to a stale store position or momentarily drop its wires (item 1.4).
      return !!prev.selected === wantSel ? prev : { ...prev, selected: wantSel };
    }
    return wantSel ? { ...fn, selected: true } : fn;
  });

  return {
    nodes,
    cache: {
      graphKey,
      nodeSigs: new Map(graph.nodes.map((n) => [n.id, triggerNodeSignature(n)])),
    },
  };
}
