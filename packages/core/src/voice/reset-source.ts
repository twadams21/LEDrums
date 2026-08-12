import type { TriggerGraph, TriggerSource } from './types';

// ---- Sequence reset bindings -------------------------------------------------
//
// A `sequence` node may carry its own `resetSource` (see `GraphNode.resetSource`): a drum pad,
// MIDI note, or OSC address that snaps THAT node back to its first step. Deliberately contained
// in the node (issue #159): there is no cross-graph target key to rewrite on song copy, and no
// trigger-flow participation — a matching input clears step state and fires nothing. This module
// is the ONE resolution + application path, imported by both the core engine and the web sim's
// offline preview, so online and offline reset behaviour can never drift.

/**
 * The slice of an input event that reset matching reads — structural, so the engine's
 * `InputEvent`, the server's forwarded partials, and the web sim's raw fires all fit without
 * adapters. A field that is `undefined` simply matches no binding of that kind: a pad hit
 * carries `drumId`/`zone`, a raw MIDI note carries `note`, an OSC message carries `address` —
 * and a zone-mapped MIDI hit carries BOTH `drumId` and `note`, so it reaches drum-bound and
 * note-bound resets alike (mirroring how the same event can fire both resolution paths).
 */
export interface ResetInput {
  drumId?: string;
  zone?: string;
  note?: number;
  address?: string;
}

/** One matched reset binding: the `sequence` node `nodeId` in graph `graphKey`. */
export interface ResetHit {
  graphKey: string;
  nodeId: string;
}

/** Does a sequence node's reset binding match this input? `cc` MIDI sources are unreachable
    (no CC trigger event exists), exactly as on the trigger-node `source`. */
export function resetSourceMatches(src: TriggerSource, input: ResetInput): boolean {
  switch (src.kind) {
    case 'drum':
      return input.drumId !== undefined && src.drumId === input.drumId && src.zone === (input.zone ?? '');
    case 'midi':
      return src.note !== undefined && input.note !== undefined && src.note === input.note;
    case 'osc':
      return input.address !== undefined && src.address === input.address;
  }
}

/**
 * Resolve which sequence nodes this input resets, across every graph in the show. Pure +
 * deterministic (stable key order). Kept separate from graph-fire resolution on purpose: that
 * path answers "which graphs does this input play", this one "which step counters does it
 * clear" — one input may do both (a pad that both triggers a graph and resets its sequencer).
 */
export function resolveSequenceResets(graphs: Record<string, TriggerGraph>, input: ResetInput): ResetHit[] {
  const out: ResetHit[] = [];
  for (const [graphKey, graph] of Object.entries(graphs)) {
    for (const node of graph.nodes) {
      if (node.kind !== 'sequence' || !node.resetSource) continue;
      if (resetSourceMatches(node.resetSource, input)) out.push({ graphKey, nodeId: node.id });
    }
  }
  return out;
}

/**
 * Does an eval-state key belong to `(graphKey, nodeId)`?
 *
 * One authored node runs under SEVERAL state prefixes at once, because the prefix encodes the
 * firing path, not the graph alone (see `engine.resolveHitGraphs` / `resolveDirectGraphs`):
 *   - pad fallback / direct MIDI-OSC binding → prefix is the bare graph key  → `<key>#<nodeId>`
 *   - section slot position                  → prefix is `<key>#<slotIndex>` → `<key>#<slot>#<nodeId>`
 * So "reset that sequence node" means clearing EVERY prefix it currently runs under — a sequencer
 * layered into two slots has two independent step counters, and a reset must snap both.
 *
 * Matched by string surgery rather than a `RegExp` built from `graphKey`, because graph keys are
 * user-reachable (`lib:<song>/kick:0`, renamed graphs) and would otherwise need escaping. The
 * middle segment must be empty or all digits, so graph `kick` can never claim graph `kick:0`'s keys.
 */
export function isResetStateKey(stateKey: string, graphKey: string, nodeId: string): boolean {
  const prefix = `${graphKey}#`;
  const suffix = `#${nodeId}`;
  if (!stateKey.startsWith(prefix) || !stateKey.endsWith(suffix)) return false;
  const middle = stateKey.slice(prefix.length, stateKey.length - suffix.length);
  if (middle === '') return true; // `<key>#<nodeId>` — pad fallback or a direct MIDI/OSC binding
  return /^\d+$/.test(middle); // `<key>#<slotIndex>#<nodeId>` — one section slot position
}

/**
 * Resolve this input's reset bindings and clear each matched node's step position, across every
 * state prefix it runs under. Deleting the entry (rather than setting 0) is what "back to the
 * first step" means — `sequence` reads `state.seqIndex.get(sk) ?? 0`, so an absent entry IS
 * step 1. Deliberately narrow: `lastPick` (Random's no-repeat memory) and `latched` (Toggle)
 * are untouched. Returns the matched bindings so the caller can surface them (diagnostics,
 * monitor lines) and treat a reset-only input as routed.
 */
export function applySequenceResets(
  seqIndex: Map<string, number>,
  graphs: Record<string, TriggerGraph>,
  input: ResetInput,
): ResetHit[] {
  const hits = resolveSequenceResets(graphs, input);
  for (const hit of hits) {
    for (const key of [...seqIndex.keys()]) {
      if (isResetStateKey(key, hit.graphKey, hit.nodeId)) seqIndex.delete(key);
    }
  }
  return hits;
}
