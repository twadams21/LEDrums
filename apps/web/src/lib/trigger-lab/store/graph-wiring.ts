/* Freeform node-wiring validation — the connect / reconnect guards (direction, duplicate,
   cycle) as PURE predicates over a TriggerGraph (no runes/DOM). The store's `connect` /
   `reconnect` consult these, then push / repoint the edge on the live `$state` graph.
   Extracted from store.svelte.ts unchanged in behaviour. */

import { type NodeKind, type TriggerGraph, nodeHasInput, nodeHasModInput, nodeHasOutput, nodeHasParams, nodeIsModSource } from '../sim';
import { voice } from '@ledrums/core';

/** A wire's target port. `'mod'` = a modifier-chain wire into a play/modifier node's `mod`
    input; `` `param:<key>` `` (doc 10) = a modulation wire into a target's exposed param row;
    `undefined`/`'in'` = the trigger-flow input. */
export type ToPort = 'in' | 'mod' | `param:${string}` | undefined;

/** Whether a wire `from →(toPort) to` is directionally legal given the two node kinds.
     - a `param:<key>` (modulation) wire leaves ONLY a modulation source and lands ONLY on a
       params-bearing (play/modifier) node's exposed row;
     - a `mod` wire leaves ONLY a modifier node and lands ONLY on a `mod`-input node;
     - a flow wire follows the normal in/out rule, and neither a modifier NOR a modulation
       source is a flow source. */
function directionOk(fromKind: NodeKind, toKind: NodeKind, toPort: ToPort): boolean {
  if (voice.paramKeyOf(toPort) !== null) return nodeIsModSource(fromKind) && nodeHasParams(toKind);
  if (toPort === 'mod') return fromKind === 'modifier' && nodeHasModInput(toKind);
  return nodeHasOutput(fromKind) && nodeHasInput(toKind) && fromKind !== 'modifier' && !nodeIsModSource(fromKind);
}

/** Canonical source-port: `''`/null/undefined all mean "the default output". Duplicate
    detection and stored edges both go through this so no alias can slip past the dedup. */
export const normalizeFromPort = (p?: string | null): string | undefined => (p ? p : undefined);
/** Canonical target-port: `''`/`'in'`/null/undefined all mean the flow input. */
export const normalizeToPort = (p?: ToPort | null): 'mod' | `param:${string}` | undefined =>
  !p || p === 'in' ? undefined : p;

/** Whether an existing edge occupies the same (from, to, source-port, target-port) slot —
    the duplicate-wire identity, compared over canonical ports on BOTH sides. */
const sameSlot = (
  e: { from: string; to: string; fromPort?: string; toPort?: ToPort },
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): boolean =>
  e.from === fromId &&
  e.to === toId &&
  normalizeFromPort(e.fromPort) === normalizeFromPort(fromPort) &&
  normalizeToPort(e.toPort) === normalizeToPort(toPort);

/** Can node `targetId` reach node `startId` by following edges from `startId`? (cycle test). */
export function reaches(graph: TriggerGraph, startId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === targetId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of graph.edges) if (e.from === cur) stack.push(e.to);
  }
  return false;
}

/** Whether a new wire `fromId →(fromPort) toId (toPort)` is legal: distinct endpoints, both
    nodes exist, direction is valid for the port (a `mod` wire only from a modifier node into a
    `mod` input; a flow wire the normal way, never from a modifier), not a duplicate (same
    source-port → target-port), and would not form a cycle. Mirrors the old inline checks in
    `connect`. Pure + total — NEVER throws on any input (unknown ids / kinds just fail). */
export function canConnect(
  graph: TriggerGraph,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): boolean {
  if (fromId === toId) return false;
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !directionOk(from.kind, to.kind, toPort)) return false;
  // dup is per (source-port → target-port): two different bands MAY route to the same child,
  // and a node's flow `in` + `mod` inputs are distinct; the same wire on both ports is rejected.
  if (graph.edges.some((e) => sameSlot(e, fromId, toId, fromPort, toPort))) {
    return false;
  }
  return !reaches(graph, toId, fromId);
}

/** Whether moving edge `edgeId` to `fromId →(fromPort) toId (toPort)` is legal — same checks
    as {@link canConnect} but IGNORING the edge being moved (so its own presence never trips
    the dup / cycle guard). A false result means the drag should snap back, not delete the
    wire. Pure + total — never throws. */
export function canReconnect(
  graph: TriggerGraph,
  edgeId: string,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): boolean {
  if (fromId === toId) return false;
  if (!graph.edges.some((e) => e.id === edgeId)) return false;
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !directionOk(from.kind, to.kind, toPort)) return false;
  if (graph.edges.some((e) => e.id !== edgeId && sameSlot(e, fromId, toId, fromPort, toPort))) {
    return false; // dup
  }
  // cycle check over the graph WITHOUT the edge being moved
  return !reaches({ nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== edgeId) }, toId, fromId);
}
