import type { GraphEdge, TriggerGraph } from '../../trigger-lab/sim';
import { kindLabel } from './trigger-node-meta';

export type NodeYLookup = (nodeId: string) => number | undefined;

export type MixLayerRow = {
  edgeId: string;
  fromId: string;
  handleId: string;
  label: string;
  opacity: number;
  y: number;
};

export const MIX_ROW_HANDLE_PREFIX = 'mix-edge:';

export function mixRowHandleId(edgeId: string): string {
  return `${MIX_ROW_HANDLE_PREFIX}${edgeId}`;
}

export function isMixRowHandleId(handleId: string | null | undefined): boolean {
  return !!handleId && handleId.startsWith(MIX_ROW_HANDLE_PREFIX);
}

function edgeOpacity(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 1));
}

function sourceY(edge: Pick<GraphEdge, 'from'>, nodeById: Map<string, TriggerGraph['nodes'][number]>, liveY?: NodeYLookup): number {
  return liveY?.(edge.from) ?? nodeById.get(edge.from)?.y ?? 0;
}

export function mixLayerRowsFor(graph: TriggerGraph, mixNodeId: string, liveY?: NodeYLookup): MixLayerRow[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((edge) => edge.to === mixNodeId && (edge.toPort == null || edge.toPort === 'in'))
    .map((edge): MixLayerRow | null => {
      const source = nodeById.get(edge.from);
      if (!source) return null;
      return {
        edgeId: edge.id,
        fromId: edge.from,
        handleId: mixRowHandleId(edge.id),
        label: kindLabel[source.kind] ?? source.kind,
        opacity: edgeOpacity(edge.opacity),
        y: sourceY(edge, nodeById, liveY),
      };
    })
    .filter((row): row is MixLayerRow => row !== null)
    .sort((a, b) => a.y - b.y || a.fromId.localeCompare(b.fromId) || a.edgeId.localeCompare(b.edgeId));
}

export function mixLayerRowsSignature(graph: TriggerGraph, mixNodeId: string, liveY?: NodeYLookup): string {
  return mixLayerRowsFor(graph, mixNodeId, liveY)
    .map((row) => `${row.edgeId}:${row.fromId}:${row.y}:${row.opacity}`)
    .join('|');
}
