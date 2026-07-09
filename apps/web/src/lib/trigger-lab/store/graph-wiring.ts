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
  return nodeHasOutput(fromKind) && nodeHasInput(toKind) && !nodeIsModSource(fromKind);
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

/** Why a wire was refused — the three user-facing rejection reasons (R03 / doc 1.1). A drag
    that lands on an invalid target surfaces exactly one of these (checked in this precedence):
     - `direction`: the two ports can't legally connect this way (an output into an input, a
       modifier only into a `mod` input, etc.) — also covers a missing/unknown endpoint;
     - `duplicate`: that exact `(from-port → to-port)` slot is already wired;
     - `cycle`: the wire would feed the signal back on itself (self-loop included). */
export type WireRejection = 'direction' | 'duplicate' | 'cycle';

/** The rejection reason for a NEW wire `fromId →(fromPort) toId (toPort)`, or `null` when the
    wire is legal. The single source of wiring verdicts: {@link canConnect} is `=== null` over
    this, and the UI surfaces the reason (red in-drag styling + a toast). Precedence matters —
    an impossible-direction wire is reported as `direction`, never as a phantom duplicate/cycle.
    Pure + total — NEVER throws on any input (unknown ids / kinds just yield `direction`). */
export function classifyConnection(
  graph: TriggerGraph,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): WireRejection | null {
  if (fromId === toId) return 'cycle'; // a node wired to itself is the smallest loop
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !directionOk(from.kind, to.kind, toPort)) return 'direction';
  // dup is per (source-port → target-port): two different bands MAY route to the same child,
  // and a node's flow `in` + `mod` inputs are distinct; the same wire on both ports is rejected.
  if (graph.edges.some((e) => sameSlot(e, fromId, toId, fromPort, toPort))) return 'duplicate';
  if (reaches(graph, toId, fromId)) return 'cycle';
  return null;
}

/** The rejection reason for moving edge `edgeId` to `fromId →(fromPort) toId (toPort)`, or `null`
    when legal — same checks as {@link classifyConnection} but IGNORING the edge being moved (so
    its own presence never trips the dup / cycle guard). Pure + total — never throws. */
export function classifyReconnect(
  graph: TriggerGraph,
  edgeId: string,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): WireRejection | null {
  if (fromId === toId) return 'cycle';
  if (!graph.edges.some((e) => e.id === edgeId)) return 'direction'; // no such edge to move
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to || !directionOk(from.kind, to.kind, toPort)) return 'direction';
  if (graph.edges.some((e) => e.id !== edgeId && sameSlot(e, fromId, toId, fromPort, toPort))) {
    return 'duplicate';
  }
  // cycle check over the graph WITHOUT the edge being moved
  if (reaches({ nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== edgeId) }, toId, fromId)) {
    return 'cycle';
  }
  return null;
}

/** Whether dropped node `nodeId` can splice into edge `edgeId` (R08): the edge must be a plain
    trigger-FLOW wire (its target is the default flow input — never a `mod` chain or a `param:`
    modulation wire, where "insert a node in the middle" has no meaning), the node must not be one
    of the edge's own endpoints, and BOTH resulting wires must be legal on their own —
    `source →(source-port) node` on the node's flow input, and `node → target (target-port)` back
    onto the target's original input port. Validation runs on the graph WITHOUT the spliced edge
    (it is removed by the splice), so the edge being replaced never trips the dup / cycle guard.
    Pure + total — never throws (unknown ids just yield `false`). */
export function canSplice(graph: TriggerGraph, edgeId: string, nodeId: string): boolean {
  const edge = graph.edges.find((e) => e.id === edgeId);
  if (!edge) return false;
  if (normalizeToPort(edge.toPort) !== undefined) return false; // flow wires only
  if (edge.from === nodeId || edge.to === nodeId) return false; // can't splice into your own wire
  const without: TriggerGraph = { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) };
  return (
    classifyConnection(without, edge.from, nodeId, edge.fromPort, undefined) === null &&
    classifyConnection(without, nodeId, edge.to, undefined, edge.toPort) === null
  );
}

/** Whether a new wire `fromId →(fromPort) toId (toPort)` is legal: distinct endpoints, both
    nodes exist, direction is valid for the port (a `mod` wire only from a modifier node into a
    `mod` input; a flow wire the normal way, never from a modifier), not a duplicate (same
    source-port → target-port), and would not form a cycle. Pure + total — NEVER throws on any
    input (unknown ids / kinds just fail). Thin verdict over {@link classifyConnection}. */
export function canConnect(
  graph: TriggerGraph,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): boolean {
  return classifyConnection(graph, fromId, toId, fromPort, toPort) === null;
}

/** Whether moving edge `edgeId` to `fromId →(fromPort) toId (toPort)` is legal — same checks
    as {@link canConnect} but IGNORING the edge being moved (so its own presence never trips
    the dup / cycle guard). A false result means the drag should snap back, not delete the
    wire. Pure + total — never throws. Thin verdict over {@link classifyReconnect}. */
export function canReconnect(
  graph: TriggerGraph,
  edgeId: string,
  fromId: string,
  toId: string,
  fromPort?: string,
  toPort?: ToPort,
): boolean {
  return classifyReconnect(graph, edgeId, fromId, toId, fromPort, toPort) === null;
}
