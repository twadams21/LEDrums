import { voice } from '@ledrums/core';
import type { GraphEdge, GraphNode, NodeKind, TriggerGraph } from '../../trigger-lab/sim';
import { graphToFlowNodes, type TriggerFlowNode } from './graph-to-flow';

export type TriggerProjectionCache = {
  graphKey: string | null;
  nodeSigs: Map<string, string>;
};

/** The identity of a Mix node's dynamic input handles: one `mix-edge:<edgeId>` row per incoming
    FLOW edge (see graph-to-flow's mix-row handles). Sorted by edge id so it is the row SET, order-
    independent of edge declaration order — a source-node drag reorders rows visually without
    perturbing this. Empty when the graph isn't supplied (defensive) or the node takes no flow rows.
    Modulation (`param:*`) / modifier (`mod`) wires are excluded — they are not mix input rows. */
function mixRowSetSignature(graph: TriggerGraph | null | undefined, mixNodeId: string): string {
  if (!graph) return '';
  return graph.edges
    .filter((e) => e.to === mixNodeId && (e.toPort == null || e.toPort === 'in'))
    .map((e) => e.id)
    .sort()
    .join(',');
}

/**
 * What one kind contributes to its node's signature, on top of the shared `base`.
 *
 * Typed against that kind's own {@link voice.NodeView} arm (S11), not the flat `GraphNode`. After
 * S6 this Record was total over kinds, but every entry still received the whole 40-field record —
 * so an arm could freely read a field belonging to a DIFFERENT kind, which is what made the
 * omissions in primitive-obsession-0009 possible in the first place. A cross-kind read is now a
 * compile error instead of a silent read of an always-undefined field.
 */
type SigFn<K extends NodeKind> = (
  n: voice.NodeViewOf<K>,
  base: string,
  graph: TriggerGraph | null | undefined,
) => string;

/** A kind that deliberately contributes NOTHING beyond `base`. Spelled as a named function rather
    than an inline arrow at ten keys so "this kind has no structural fields" reads as a DECISION on
    the page — which is the whole point of deleting the old `default:` arm. Takes `unknown` because
    it reads no field at all, which makes it assignable to every arm's SigFn. */
const baseOnly = (_n: unknown, base: string): string => base;

/** The effect leaf's contribution. It carried a second `play` key until 06C dropped that alias
    from the authoring union — the two-key arrangement existed only so the spellings could not
    drift, and spelling ONLY 'play' is exactly what made the arm dead in the first place (S1).
    With one kind there is one key, and `triggerNodeSignature`'s own suite pins that a persisted
    `play` node is rewritten to `effect` by the load normalizer before it can ever reach here. */
const effectSig: SigFn<'effect'> = (n, base) =>
  `${base}:playType=${n.playType ?? ''}:effect=${n.effectId}:canvas=${n.canvasScene ?? ''}`;

/**
 * Per-kind signature contributions, keyed on NodeKind with NO DEFAULT ARM. The old
 * `default: return base` is what let repeated-switches-0001 exist at all — it silently absorbed
 * every kind nobody had thought about, which is exactly how `effect` came to be unsigned (S1).
 * Being a total `Record<NodeKind, SigFn>`, adding a kind to the union is now a COMPILE ERROR here
 * instead of a silent fallthrough. Same idiom as trigger-node-meta.ts's three tables.
 *
 * TEN canonical kinds legitimately contribute nothing and each gets an explicit `baseOnly` entry:
 * trigger, all, random, sequence, chance, toggle, delay, scope, output, envelope. That count is
 * measured, not assumed — the golden table in the test file is the authority, so a miscount here
 * fails a test rather than shipping.
 */
const KIND_SIG: { [K in NodeKind]: SigFn<K> } = {
  // --- contributes nothing beyond base (10 canonical kinds, deliberately) ---
  trigger: baseOnly,
  all: baseOnly,
  random: baseOnly,
  sequence: baseOnly,
  chance: baseOnly,
  toggle: baseOnly,
  delay: baseOnly,
  scope: baseOnly,
  output: baseOnly,
  envelope: baseOnly,

  // --- carries structural fields ---
  switch: (n, base) => `${base}:on=${n.on}:valueMode=${n.valueMode}:bands=${(n.bands ?? []).join(',')}`,
  effect: effectSig,

  modifier: (n, base) => `${base}:modifier=${n.modifierId ?? ''}`,
  mix: (n, base, graph) => `${base}:mix=${n.mixBlendMode ?? 'normal'}:rows=${mixRowSetSignature(graph, n.id)}`,
  cc: (n, base) => `${base}:cc=${n.ccController ?? ''}:${n.ccChannel ?? ''}`,
  note: (n, base) =>
    `${base}:note=${n.noteNumber ?? ''}:${n.noteChannel ?? ''}:${n.noteMode ?? ''}:${n.noteReleaseMs ?? ''}`,
  osc: (n, base) => `${base}:osc=${n.oscAddress ?? ''}`,
  randomMod: (n, base) => `${base}:random=${n.randomDistribution ?? ''}:${n.randomSteps ?? ''}`,
  lfo: (n, base) =>
    `${base}:lfo=${n.lfo?.waveform ?? ''}:${n.lfo?.rateMode ?? ''}:${n.lfo?.rateHz ?? ''}:${n.lfo?.division ?? ''}:${n.lfo?.phase ?? ''}`,
};

/** Structural signature of a graph node for projection reuse. When `graph` is supplied, a Mix
    node's signature also folds in its incoming flow-edge SET, so ADDING or REMOVING a wire into a
    Mix node rebuilds it — xyflow then re-measures the per-edge `mix-edge:<id>` handles instead of
    reusing stale bounds that have nowhere to attach the new wire (R01/GH #80: the vanishing wire).
    Mirrors how `modInputs` (a play/modifier node's dynamic param handles) already lives in `base`. */
export function triggerNodeSignature(n: GraphNode, graph?: TriggerGraph | null): string {
  // `base` is deliberately computed on the FLAT record: `modInputs` is a play/modifier field, yet
  // every kind's base folds it in, so this read is cross-kind BY DESIGN and belongs here, before
  // the per-kind narrowing, rather than inside any arm.
  const modInputs = (n.modInputs ?? []).map((m) => m.param).join(',');
  const base = `${n.id}:${n.kind}:pos=${n.x},${n.y}:mod=${modInputs}`;
  const v = voice.narrowNode(n);
  // The one widening keyed-Record dispatch costs in TS, confined to this single line: indexing
  // with `v.kind` yields the UNION of every arm's SigFn, whose parameters TS intersects, so no
  // real value satisfies it — `never` is assignable to all of them. The narrowing is not lost:
  // each ENTRY above is type-checked against its own arm; only the call site is widened.
  return KIND_SIG[v.kind](v as never, base, graph);
}

export function triggerEdgeSignature(e: Pick<GraphEdge, 'id' | 'from' | 'to' | 'fromPort' | 'toPort' | 'opacity'>): string {
  return `${e.id}:${e.from}:${e.fromPort ?? ''}>${e.to}:${e.toPort ?? ''}:opacity=${e.opacity ?? ''}`;
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
    const sig = triggerNodeSignature(sn, graph);
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
      nodeSigs: new Map(graph.nodes.map((n) => [n.id, triggerNodeSignature(n, graph)])),
    },
  };
}
