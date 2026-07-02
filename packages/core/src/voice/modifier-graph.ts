/**
 * Modifier-chain resolution — the pure graph→chain transform that turns a play node's
 * wired `mod` input into the flat {@link ResolvedModifier}[] the engine carries on a voice.
 * The ONE seam between graph topology (S29) and the modifier engine (S28): the compositor
 * never sees the graph, only the resolved chain.
 *
 * LOCKED model (doc 06 §C, 2026-07-02):
 *  - A modifier node wires to a play (or another modifier) node's `mod` input handle
 *    (`GraphEdge.toPort === 'mod'`). One modifier node may feed MANY play nodes — shared
 *    params, independent per-voice state (state is created per voice by the chain runner).
 *  - Chains are explicit via mod→mod wiring: `Grain → Bloom → Play` applies Grain THEN
 *    Bloom. When several modifiers wire in PARALLEL to one input, order = node y-position
 *    (the Patch graph's transmit-order precedent).
 *
 * Pure + deterministic — no IO, no time. Shared byte-for-byte by the core engine
 * (`eval-graph.ts`, real output) and the web-sim mirror (`sim.ts`, offline preview) so the
 * two chains can never drift.
 */
import type { GraphNode, ResolvedModifier, TriggerGraph } from './types';

/** Map a modifier node to its resolved link (params/bypass passed verbatim; unknown
    `modifierId` is left as-is — the chain runner skips it, never throwing on the hot path). */
function toResolvedModifier(node: GraphNode): ResolvedModifier {
  const link: ResolvedModifier = { modifierId: node.modifierId ?? '', params: node.params };
  if (node.bypass) link.bypass = true;
  return link;
}

/**
 * Resolve `node`'s `mod` input into an ordered modifier chain. Walks every edge whose
 * `toPort === 'mod'` landing on `node`, keeps only modifier-kind sources, orders them by
 * y-position (parallel wires), and for each resolves ITS upstream chain first (mod→mod) so
 * the front-to-back applied order is correct. Returns `[]` when nothing is wired, so the
 * caller keeps an unmodified voice on the zero-alloc hot path.
 *
 * `seen` guards cycles (a modifier graph the connect validator normally rejects, but
 * un-migrated / hand-edited data must never loop): a node already on the current path
 * contributes nothing.
 */
export function resolveModifierChain(
  graph: TriggerGraph,
  node: GraphNode,
  seen: Set<string> = new Set(),
): ResolvedModifier[] {
  if (seen.has(node.id)) return [];
  const seen2 = new Set(seen).add(node.id);
  const sources = graph.edges
    .filter((e) => e.to === node.id && e.toPort === 'mod')
    .map((e) => graph.nodes.find((n) => n.id === e.from))
    .filter((n): n is GraphNode => !!n && n.kind === 'modifier')
    .sort((a, b) => a.y - b.y);
  const chain: ResolvedModifier[] = [];
  for (const m of sources) {
    chain.push(...resolveModifierChain(graph, m, seen2)); // upstream (mod→mod) applies first
    chain.push(toResolvedModifier(m));
  }
  return chain;
}
