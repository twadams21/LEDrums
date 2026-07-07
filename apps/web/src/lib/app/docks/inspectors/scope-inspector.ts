import { voice } from '@ledrums/core';
import type { GraphNode, Scope } from '../../../trigger-lab/sim';

export type DrumInfo = { id: string; label: string; hoopCount: number };

export type ScopeSelection =
  | { kind: 'kit' }
  | { kind: 'drum'; drumId: string }
  | { kind: 'hoops'; drumId: string; hoops: number[] };

export type ScopeReadout = {
  label: string;
  detail: string;
  empty: boolean;
  noOp: boolean;
};

type FlowEdge = { from: string; to: string; toPort?: string | null };

export function hoopLabel(index: number): string {
  return `Hoop ${index + 1}`;
}

export function parseHoopTarget(targetId: string | undefined, fallbackDrumId: string): { drumId: string; hoops: number[] } {
  if (!targetId || !targetId.includes('#')) return { drumId: fallbackDrumId, hoops: [0] };
  const sep = targetId.indexOf('#');
  const drumId = targetId.slice(0, sep) || fallbackDrumId;
  const hoops = targetId
    .slice(sep + 1)
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0);
  return { drumId, hoops: [...new Set(hoops)].sort((a, b) => a - b) };
}

export function encodeHoopTarget(drumId: string, hoops: readonly number[]): string {
  const normalized = [...new Set(hoops)].filter((v) => Number.isInteger(v) && v >= 0).sort((a, b) => a - b);
  return `${drumId}#${normalized.join(',')}`;
}

export function selectionFromNode(node: Pick<GraphNode, 'scope' | 'targetId'>, drums: readonly DrumInfo[], fallbackDrumId = drums[0]?.id ?? 'kick'): ScopeSelection {
  if (node.scope === 'kit') return { kind: 'kit' };
  if (node.scope === 'drum') return { kind: 'drum', drumId: node.targetId || fallbackDrumId };
  const parsed = parseHoopTarget(node.targetId, fallbackDrumId);
  return { kind: 'hoops', drumId: parsed.drumId, hoops: parsed.hoops.length ? parsed.hoops : [0] };
}

export function commitSelection(node: GraphNode, selection: ScopeSelection, setScope: (node: GraphNode, scope: Scope) => void, setTargetId: (node: GraphNode, targetId: string | undefined) => void): void {
  if (selection.kind === 'kit') {
    setScope(node, 'kit');
    return;
  }
  if (selection.kind === 'drum') {
    if (node.scope !== 'drum') setScope(node, 'drum');
    setTargetId(node, selection.drumId);
    return;
  }
  if (node.scope !== 'hoop') setScope(node, 'hoop');
  setTargetId(node, encodeHoopTarget(selection.drumId, selection.hoops));
}

export function toggleHoop(current: readonly number[], hoop: number, multi: boolean): number[] {
  if (!multi) return [hoop];
  const next = new Set(current);
  if (next.has(hoop)) next.delete(hoop);
  else next.add(hoop);
  return [...next].sort((a, b) => a - b);
}

export function isPrimaryMultiSelect(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey;
}

function drumLabel(drums: readonly DrumInfo[], drumId: string): string {
  return drums.find((d) => d.id === drumId)?.label ?? drumId;
}

export function describeSelection(selection: ScopeSelection, drums: readonly DrumInfo[]): ScopeReadout {
  if (selection.kind === 'kit') return { label: 'Whole kit', detail: 'No filter', empty: false, noOp: true };
  if (selection.kind === 'drum') return { label: drumLabel(drums, selection.drumId), detail: 'Whole drum', empty: false, noOp: false };
  if (!selection.hoops.length) return { label: drumLabel(drums, selection.drumId), detail: 'None', empty: true, noOp: false };
  return {
    label: drumLabel(drums, selection.drumId),
    detail: selection.hoops.map(hoopLabel).join(', '),
    empty: false,
    noOp: false,
  };
}

function isFlowEdgeTo(edge: FlowEdge, nodeId: string): boolean {
  return edge.to === nodeId && (edge.toPort == null || edge.toPort === 'in');
}

function isScopeCarrier(node: GraphNode): boolean {
  return node.kind === 'effect' || node.kind === 'play' || node.kind === 'scope' || node.kind === 'output';
}

function targetKey(target: voice.ScopeTarget): string {
  return `${target.scope}:${target.targetId ?? ''}`;
}

function uniqueTargets(targets: readonly voice.ScopeTarget[]): voice.ScopeTarget[] {
  const seen = new Set<string>();
  const out: voice.ScopeTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function upstreamScopesFor(
  nodeId: string,
  byId: ReadonlyMap<string, GraphNode>,
  edges: readonly FlowEdge[],
  sourceDrumId: string,
  seen: ReadonlySet<string> = new Set(),
): voice.ScopeTarget[] {
  if (seen.has(nodeId)) return [];
  const incoming = edges.filter((edge) => isFlowEdgeTo(edge, nodeId));
  if (!incoming.length) return [{ scope: 'kit' }];
  const nextSeen = new Set(seen);
  nextSeen.add(nodeId);

  const out: voice.ScopeTarget[] = [];
  for (const edge of incoming) {
    const upstream = byId.get(edge.from);
    for (const base of upstreamScopesFor(edge.from, byId, edges, sourceDrumId, nextSeen)) {
      if (!upstream || !isScopeCarrier(upstream)) {
        out.push(base);
        continue;
      }
      const scoped = voice.intersectScopeTargets(base, upstream, sourceDrumId);
      if (scoped) out.push(scoped);
    }
  }
  return uniqueTargets(out);
}

export function effectiveScopeForNode(
  graph: { nodes: GraphNode[]; edges: FlowEdge[] } | null | undefined,
  node: GraphNode,
  drums: readonly DrumInfo[],
  sourceDrumId = drums[0]?.id ?? 'kick',
): ScopeReadout {
  const upstream = graph ? upstreamScopesFor(node.id, new Map(graph.nodes.map((n) => [n.id, n])), graph.edges, sourceDrumId) : [{ scope: 'kit' }];
  if (!upstream.length) return { label: 'Empty', detail: 'No LEDs after upstream filters', empty: true, noOp: false };

  const afterLocal = uniqueTargets(
    upstream
      .map((target) => voice.intersectScopeTargets(target, node, sourceDrumId))
      .filter((target): target is voice.ScopeTarget => !!target),
  );
  if (!afterLocal.length) return { label: 'Empty', detail: 'No LEDs after this Scope', empty: true, noOp: false };
  if (afterLocal.length > 1) {
    return {
      label: 'Mixed routes',
      detail: 'Upstream branches resolve to different LED scopes',
      empty: false,
      noOp: false,
    };
  }

  const local = afterLocal[0]!;
  const selection = selectionFromNode(local as Pick<GraphNode, 'scope' | 'targetId'>, drums, sourceDrumId);
  const readout = describeSelection(selection, drums);
  if (node.scope === 'kit' && upstream.some((target) => target.scope !== 'kit')) {
    return { ...readout, detail: `${readout.detail} · whole-kit Scope is no-op`, noOp: true };
  }
  return readout;
}
