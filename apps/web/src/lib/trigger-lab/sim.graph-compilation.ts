/* =============================================================================
   TRIGGER LAB — trigger graph types + compilation (extracted from sim.ts, S3.3).

   The freeform node-graph model (GraphNode/GraphEdge/TriggerGraph + makeNode),
   the Block-tree → graph compiler (treeToGraph), and the legacy velocity → value
   switch fold migration. Pure — no behaviour change. Part of the throwaway lab.

   NOTE (S4.4 — canonical graph types, DONE): the graph types `NodeKind` /
   `GraphNode` / `GraphEdge` / `TriggerGraph` are now CANONICAL in `@ledrums/core`
   (`voice/types.ts`) and re-exported here as type aliases (`voice.*`) so the
   public `./sim` surface is unchanged — they are no longer declared locally.
   `GraphNode.source` is `voice.TriggerSource` (also aliased in
   `./sim.trigger-source`). Type-only import — adds NO runtime dependency on core
   (core stays pure). The block-tree types they consume (`Block`, `BlockKind`)
   still live in `./sim`.
   ============================================================================= */

import { voice } from '@ledrums/core';
import { cloneEnvelope, type EnvMap } from './sim.envelopes';
import type { Block, BlockKind } from './sim';

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

/* Canonical in `@ledrums/core` (`voice/types.ts`) — re-exported here as type
   aliases so the `./sim` surface is unchanged. `GraphNode` carries every kind's
   fields (only the ones for its `kind` are meaningful) so editors need no
   narrowing; `GraphNode.source` is `voice.TriggerSource`. See the header NOTE. */
export type NodeKind = voice.NodeKind;
export type GraphNode = voice.GraphNode;
export type GraphEdge = voice.GraphEdge;
export type TriggerGraph = voice.TriggerGraph;

/** Node kinds a user can add from the palette (the trigger input is implicit). `delay`,
    `modifier` + `envelope` are `NodeKind`s but not block types in the Block union, so the
    element type is widened to `Exclude<NodeKind, 'trigger'>`. `envelope` is a modulation
    source (doc 10) — palette-grouped separately, but addable like the rest. */
export const NODE_KINDS: Array<Exclude<NodeKind, 'trigger'>> = ['play', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle', 'delay', 'modifier', 'envelope', 'lfo']; // S36 'lfo'

/** Whether a kind emits a trigger-flow / mod / modulation OUTPUT handle. 'play' is a sink (no
    children); 'trigger' is a source. A 'modifier' emits its `mod` output; a modulation source
    ('envelope', doc 10) emits its modulation output — both wire from the right, so both count. */
export const nodeHasOutput = (kind: NodeKind): boolean => kind !== 'play';
/** Whether a kind takes a trigger-FLOW input (the default `in` handle). 'trigger' is the
    root; 'modifier' + modulation sources ('envelope') take NO flow input — their inputs are
    the `mod` handle / none, so they are excluded here. */
export const nodeHasInput = (kind: NodeKind): boolean => kind !== 'trigger' && kind !== 'modifier' && !voice.isModSourceKind(kind);
/** Whether a kind exposes a `mod` INPUT handle (a modifier chain lands here). Play nodes
    take modifiers; modifier nodes take upstream modifiers (mod→mod chains). */
export const nodeHasModInput = (kind: NodeKind): boolean => kind === 'play' || kind === 'modifier';
/** Whether a kind carries exposable modulation-target params (play + modifier nodes). A
    `param:<key>` modulation wire may land only on these. */
export const nodeHasParams = (kind: NodeKind): boolean => kind === 'play' || kind === 'modifier';
/** Whether a kind is a modulation SOURCE (wires from its output into a `param:<key>` input).
    Re-exported from core so the wiring layer and the resolver share one list. */
export const nodeIsModSource = (kind: NodeKind): boolean => voice.isModSourceKind(kind);

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
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    // delay (only meaningful when kind === 'delay'; defaults mirror the core engine defaults)
    delayMode: 'time',
    ms: 250,
    division: '1/8',
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
