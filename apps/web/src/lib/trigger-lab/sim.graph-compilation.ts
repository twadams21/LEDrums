/* =============================================================================
   TRIGGER LAB — trigger graph types + compilation (extracted from sim.ts, S3.3).

   The freeform node-graph model (GraphNode/GraphEdge/TriggerGraph + makeNode),
   the Block-tree → graph compiler (treeToGraph), and the legacy velocity → value
   switch fold migration. Pure — no behaviour change. Part of the throwaway lab.

   NOTE (for S4.4 — canonical graph types): the graph TYPES below
   (`NodeKind`, `GraphNode`, `GraphEdge`, `TriggerGraph`) are the local sim
   mirror of the engine's graph types. S4.4 re-points these to `@ledrums/core`;
   left as-is here. The block-tree types they consume (`Block`, `BlockKind`,
   `PlayMode`, `Scope`, `SwitchOn`, `ValueMode`) still live in `./sim`.
   ============================================================================= */

import { cloneEnvelope, type EnvMap, type ParamValues } from './sim.envelopes';
import type { Block, BlockKind, PlayMode, Scope, SwitchOn, ValueMode } from './sim';
import type { TriggerSource } from './sim.trigger-source';

// ---- Block-tree traversal ---------------------------------------------------

export function blockChildren(b: Block): Block[] {
  switch (b.kind) {
    case 'all':
    case 'random':
    case 'sequence':
    case 'switch':
      return b.children;
    case 'chance':
    case 'toggle':
      return [b.child];
    default:
      return [];
  }
}

// ---- Trigger graph (freeform node wiring) -----------------------------------

export type NodeKind = 'trigger' | BlockKind;

/** A node in the freeform trigger graph. Carries every kind's fields (only the
    ones for its `kind` are meaningful) so the editor + dialogs need no narrowing. */
export interface GraphNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  // play
  mode: PlayMode;
  scope: Scope;
  effectId: string;
  presetId: string;
  /** layer/bus override for this node ('' → the effect's default bus). */
  busId: string;
  params: ParamValues;
  env: EnvMap;
  linked: boolean;
  // random
  noRepeat: boolean;
  // switch
  on: SwitchOn;
  /** value-switch sub-mode (only meaningful when on==='value'). */
  valueMode: ValueMode;
  /** gate cutoff 0..1 (value-switch gate). */
  threshold: number;
  /** gate direction: false → pass when value ≤ threshold; true → pass when value > threshold. */
  invert: boolean;
  /** ascending band cutoffs 0..1 (value-switch bands). N bands = N−1 cutoffs; the
      last band is "the rest" (value above the final cutoff). */
  bands: number[];
  // chance
  p: number;
  // trigger (only meaningful on the `trigger` node)
  /** What input fires this graph. Optional + additive: graphs persisted before the
      trigger-source model lack it — the store hydrate back-fills a `drum` source from
      the pad key for pad-bound graphs; authored graphs stay unset until bound. */
  source?: TriggerSource;
}

export interface GraphEdge {
  id: string;
  from: string; // source node id (output port)
  to: string; // target node id (input port)
  /** source handle id this edge leaves from. undefined = the node's default single
      output (back-compat). For a value+bands switch, band i's handle is `band-${i}`. */
  fromPort?: string;
}

export interface TriggerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Block kinds a user can add as graph nodes (the trigger input is implicit). */
export const NODE_KINDS: BlockKind[] = ['play', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle'];

/** 'play' is a sink (no children); 'trigger' is a source (no parent). */
export const nodeHasOutput = (kind: NodeKind): boolean => kind !== 'play';
export const nodeHasInput = (kind: NodeKind): boolean => kind !== 'trigger';

function cloneEnvMap(env: EnvMap): EnvMap {
  const out: EnvMap = {};
  for (const k of Object.keys(env)) out[k] = cloneEnvelope(env[k]!);
  return out;
}

/** A node with default field values; override per kind via `over`. */
export function makeNode(kind: NodeKind, id: string, x = 0, y = 0, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x,
    y,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    ...over,
  };
}

/** Resolve which band a 0..1 value lands in against ascending cutoffs. N cutoffs →
    N+1 bands: value ≤ cutoffs[0] → 0; ≤ cutoffs[1] → 1; …; value above the last
    cutoff → the final band (index = cutoffs.length). Empty cutoffs → band 0. */
export function bandIndex(value: number, cutoffs: readonly number[]): number {
  for (let i = 0; i < cutoffs.length; i++) {
    if (value <= cutoffs[i]!) return i;
  }
  return cutoffs.length;
}

// ---- Block tree → graph compilation -----------------------------------------

function nodeFromBlock(b: Block): GraphNode {
  switch (b.kind) {
    case 'play':
      return makeNode('play', b.id, 0, 0, {
        mode: b.mode,
        scope: b.scope,
        effectId: b.effectId,
        presetId: b.presetId,
        params: { ...b.params },
        env: cloneEnvMap(b.env),
        linked: b.linked,
      });
    case 'random':
      return makeNode('random', b.id, 0, 0, { noRepeat: b.noRepeat });
    case 'switch': {
      const over: Partial<GraphNode> = { on: b.on };
      if (b.valueMode !== undefined) over.valueMode = b.valueMode;
      if (b.bands !== undefined) over.bands = b.bands;
      return makeNode('switch', b.id, 0, 0, over);
    }
    case 'chance':
      return makeNode('chance', b.id, 0, 0, { p: b.p });
    default:
      return makeNode(b.kind, b.id);
  }
}

export const NODE_W = 220;
const H_GAP = 90;
const ROW_H = 140;

/** Convert an authored Block tree into a positioned graph (trigger + nodes + edges). */
export function treeToGraph(tree: Block): TriggerGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let row = 0;
  let edgeSeq = 0;
  const link = (from: string, to: string, fromPort?: string): void => {
    edges.push(fromPort === undefined ? { id: `e${edgeSeq++}`, from, to } : { id: `e${edgeSeq++}`, from, to, fromPort });
  };

  const walk = (b: Block, depth: number): { id: string; y: number } => {
    const node = nodeFromBlock(b);
    node.x = depth * (NODE_W + H_GAP);
    nodes.push(node);
    const kids = blockChildren(b);
    if (kids.length === 0) {
      node.y = row++ * ROW_H;
    } else {
      // A value+bands switch routes each child from its own band handle (`band-${i}`),
      // in child order — which is top→bottom (ascending y) in this layout, matching
      // both childrenViaPort's y-sort and the fold migration, so a seed graph is
      // identical to a migrated persisted one.
      const bandPorts = b.kind === 'switch' && b.on === 'value' && b.valueMode === 'bands';
      const infos = kids.map((k, i) => {
        const ci = walk(k, depth + 1);
        link(node.id, ci.id, bandPorts ? `band-${i}` : undefined);
        return ci;
      });
      node.y = (infos[0]!.y + infos[infos.length - 1]!.y) / 2;
    }
    return { id: node.id, y: node.y };
  };

  const root = walk(tree, 1);
  const trigger = makeNode('trigger', 'trigger', 0, root.y);
  nodes.push(trigger);
  link(trigger.id, root.id);
  return { nodes, edges };
}

// ---- velocity → value fold (migration) --------------------------------------

/** Evenly-spaced ascending cutoffs that split 0..1 into `n` equal bands: `[1/n, …, (n−1)/n]`
    (n−1 cutoffs; `n ≤ 1` → `[]`, a single band). Reproduces the old `velocity` switch's
    even-by-count split expressed as `value`+`bands`. */
function evenCutoffs(n: number): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < n; i++) cuts.push(i / n);
  return cuts;
}

/** `velocity` was dropped from {@link SwitchOn}; a stray one is read via a string compare
    (this fold is the migrator for exactly that legacy value). */
const isVelocitySwitch = (n: GraphNode): boolean => n.kind === 'switch' && (n.on as string) === 'velocity';

/** Fold every legacy `on:'velocity'` switch in a graph into the canonical `value`+`bands`
    form, behaviour-preserving:
      - `on='value'`, `valueMode='bands'`, `bands = evenCutoffs(N)` where N is the switch's
        outgoing-edge count (N even bands == the old even-by-count split), and
      - each outgoing edge re-homed onto its band handle `band-${i}`, edges sorted by target
        y ascending — the order the old velocity switch fired children in (`childrenOf`).
    Edge cases: N≤1 → one band (`band-0`); N=0 → nothing to wire. `section`/`beat` switches
    and non-switch nodes are untouched. Idempotent + immutable: returns the SAME graph
    reference when there is no velocity switch, so re-running — or a graph authored after the
    fold — is a no-op. */
export function foldVelocitySwitch(graph: TriggerGraph): TriggerGraph {
  if (!graph.nodes.some(isVelocitySwitch)) return graph;

  const yOf = new Map(graph.nodes.map((n) => [n.id, n.y] as const));
  const migrated = new Set<string>();
  const nodes = graph.nodes.map((n) => {
    if (!isVelocitySwitch(n)) return n;
    migrated.add(n.id);
    const outCount = graph.edges.reduce((c, e) => (e.from === n.id ? c + 1 : c), 0);
    return { ...n, on: 'value' as const, valueMode: 'bands' as const, bands: evenCutoffs(outCount) };
  });

  // Re-home each migrated switch's outgoing edges onto band handles, in target-y order.
  const edges = graph.edges.map((e) => ({ ...e }));
  for (const id of migrated) {
    const outs = edges.filter((e) => e.from === id).sort((a, b) => (yOf.get(a.to) ?? 0) - (yOf.get(b.to) ?? 0));
    outs.forEach((e, i) => {
      e.fromPort = `band-${i}`;
    });
  }
  return { nodes, edges };
}

/** Apply {@link foldVelocitySwitch} across a keyed map of graphs (the store's hydrate
    migration). Each unchanged graph keeps its reference (alias-stable + idempotent). */
export function foldVelocitySwitches(graphs: Record<string, TriggerGraph>): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = foldVelocitySwitch(graph);
  return out;
}
