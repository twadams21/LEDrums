/**
 * Modulation-graph resolution (doc 10, S34) — the pure graph→mappings transform that turns a
 * target node's exposed param rows + incoming `param:<key>` modulation edges into the flat
 * {@link Mapping}[] the engine samples per frame. The ONE seam between graph topology and the
 * modulation sweep: the compositor never sees the graph, only the resolved mappings (carried on
 * `Voice.modulations` for play params and `ResolvedModifier.modulations` for modifier params —
 * one model, two carriers).
 *
 * Pure + deterministic — no IO, no time. Shared byte-for-byte by the core engine
 * (`eval-graph.ts` play case, `modifier-graph.ts` modifier links) and the web-sim mirror
 * (`sim.ts`), so offline preview and real output can never drift.
 *
 * S34 ships the `envelope` source kind. `lfo` (S36) and `cc` (S37) add a {@link ModSource}
 * arm + a `nodeModSource` case — no reshape of {@link Mapping} or the resolver.
 */
import { defaultEnvelope } from './envelope';
import { defaultLfoSettings } from './lfo'; // S36
import type { ModParamSpec, ModSource } from './modulation';
import type { GraphEdge, GraphNode, TriggerGraph } from './types';
import type { Mapping } from './modulation';

/** The well-known `env` key an `envelope` source node stores its single shape under (source
    nodes have no params, so they reuse the per-param env map with this fixed slot — lets the
    S24 editor store seam drive the node's shape verbatim). */
export const ENVELOPE_NODE_KEY = 'shape';

/** The `NodeKind`s that are modulation SOURCES (wire from their output into a `param:<key>`
    input). Widens with S36 (`'lfo'`) / S37 (`'cc'`). Kept here so the web wiring layer and the
    resolver agree on one list. */
export const MOD_SOURCE_KINDS = ['envelope', 'lfo'] as const; // S36 append 'lfo'

/** Whether a node kind is a modulation source. */
export function isModSourceKind(kind: string): boolean {
  return (MOD_SOURCE_KINDS as readonly string[]).includes(kind);
}

/** The exposed-param key an edge's `toPort` targets, or `null` when the edge is not a
    modulation wire (`undefined`/`'in'`/`'mod'`). Pure string parse — never throws. */
export function paramKeyOf(toPort: GraphEdge['toPort']): string | null {
  return typeof toPort === 'string' && toPort.startsWith('param:') ? toPort.slice('param:'.length) : null;
}

/**
 * Build the {@link ModSource} a source node contributes, or `null` when `node` is not a
 * modulation source (so a stray non-source wire resolves to nothing rather than throwing). An
 * `envelope` node's shape lives in `node.env[ENVELOPE_NODE_KEY]`; a source wired before its
 * shape is authored falls back to a decay envelope so it still animates.
 */
export function nodeModSource(node: GraphNode): ModSource | null {
  switch (node.kind) {
    case 'envelope':
      return { kind: 'envelope', env: node.env?.[ENVELOPE_NODE_KEY] ?? defaultEnvelope('decay') };
    case 'lfo': // S36 — settings live on node.lfo; unset falls back to a default so it still animates
      return { kind: 'lfo', lfo: node.lfo ?? defaultLfoSettings() };
    default:
      return null;
  }
}

function specFor(specs: readonly ModParamSpec[], key: string): ModParamSpec | undefined {
  for (const s of specs) if (s.key === key) return s;
  return undefined;
}

const isNumberSpec = (s: ModParamSpec): boolean => (s.kind ?? s.type) === 'number';

/**
 * Resolve every incoming `param:<key>` modulation edge on `node` into a flat {@link Mapping}[].
 * One edge = one mapping onto that param key; each carries its own `amount`/`invert`/range from
 * the edge (defaults: amount 1, no invert, range from `specs` or `[0, 1]`). Non-source edges and
 * dangling sources are skipped (never thrown). When `specs` is supplied a mapping onto a
 * non-number param is dropped and the range defaults to the spec's `[min, max]`; when it's empty
 * (the play-node case, where effect specs aren't available at resolve time) mappings pass through
 * and the render-time sweep filters non-number params against the live voice specs.
 *
 * Deterministic order: edges are walked in graph order (matching how the store appends them), so
 * summed contributions on one param are stable across runs.
 */
export function resolveNodeModulations(
  graph: TriggerGraph,
  node: GraphNode,
  specs: readonly ModParamSpec[] = [],
): Mapping[] {
  const out: Mapping[] = [];
  for (const e of graph.edges) {
    if (e.to !== node.id) continue;
    const key = paramKeyOf(e.toPort);
    if (key === null) continue;
    const src = graph.nodes.find((n) => n.id === e.from);
    if (!src) continue;
    const source = nodeModSource(src);
    if (!source) continue; // not a modulation source → skip, never throw
    const spec = specFor(specs, key);
    if (spec && !isNumberSpec(spec)) continue; // known non-number param → drop
    out.push({
      targetParam: key,
      source,
      amount: typeof e.amount === 'number' ? e.amount : 1,
      invert: e.invert === true,
      rangeMin: typeof e.rangeMin === 'number' ? e.rangeMin : spec?.min ?? 0,
      rangeMax: typeof e.rangeMax === 'number' ? e.rangeMax : spec?.max ?? 1,
    });
  }
  return out;
}
