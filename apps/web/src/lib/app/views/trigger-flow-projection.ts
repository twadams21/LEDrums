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
    if (prev && cache.nodeSigs.get(fn.id) === sig && !!prev.selected === wantSel) return prev;
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
