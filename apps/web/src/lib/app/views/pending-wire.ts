/* F8 — a connection drag RELEASED IN EMPTY SPACE keeps its wire pending while the Add-node
   popover picks the node to land it on (Trent, 2026-08-17: "when dragging to create a new
   wire, if its released in empty space, show the add node menu. When a node is then clicked,
   wire it up to the wire that would have been added on release.").

   The question this module answers is "which node types can accept the pending wire?", and it
   answers it by PROBING the store's own wiring predicate ({@link canConnect}) against a
   stand-in node of each kind — never a second validity table that could drift from the one the
   graph enforces. A kind the probe accepts is a kind `dropConnect` will wire; a kind it
   refuses would have produced a node with no wire, so the palette does not offer it.

   Pure — no runes, no DOM, no store. */

import { voice } from '@ledrums/core';
import { makeNode, type NodeKind, type TriggerGraph } from '../../trigger-lab/sim';
import { canConnect, type ToPort } from '../../trigger-lab/store/graph-wiring';

/** The connection a drag released in empty space is still holding: the handle it LEFT. Mirrors
    the shape xyflow reports on `onConnectEnd` (`conn.fromHandle`). */
export type PendingWire = {
  /** The node the drag started from. */
  nodeId: string;
  /** `source` = the drag left an OUTPUT handle; `target` = it left an INPUT handle. */
  type: 'source' | 'target';
  /** The precise handle id it left (a switch band, a `param:<key>` row, `mod`), else null. */
  handleId: string | null;
};

/** The store `toPort` a target handle id means: `mod` for a modifier chain, a `param:<key>`
    modulation row verbatim, and everything else the default trigger-flow input. One definition,
    read by the view's drop path, its in-drag validity mirror, and the probe below. */
export function toPortOf(handle: string | null | undefined): ToPort {
  if (handle === 'mod') return 'mod';
  return handle && voice.paramKeyOf(handle as ToPort) !== null ? (handle as `param:${string}`) : undefined;
}

/** The stand-in node the probe wires against. Not in the graph, so it can never collide with a
    real id, trip the duplicate guard, or close a cycle — leaving DIRECTION (the only thing a
    not-yet-added node can be judged on) as the verdict. */
const PROBE_ID = '__pending-wire-probe__';
/** Any param key: a modulation wire's direction rule reads the target KIND, not the row (the row
    is exposed on demand when the wire actually lands — see `paramPortFor`). */
const PROBE_PARAM: ToPort = 'param:__probe__';

/** Would the pending wire be ACCEPTED if it were dropped on a freshly-added node of `kind`?
    Mirrors `TriggerGraphView.dropConnect`'s source-kind routing — a modifier's wire lands on
    the new node's `mod` input, a modulation source's on a `param:` row, everything else on the
    flow input; a drag that began at an INPUT handle makes the new node the SOURCE instead. */
export function acceptsPendingWire(graph: TriggerGraph, from: PendingWire, kind: NodeKind): boolean {
  const fromKind = graph.nodes.find((n) => n.id === from.nodeId)?.kind;
  if (!fromKind) return false;
  const probe: TriggerGraph = { ...graph, nodes: [...graph.nodes, makeNode(kind, PROBE_ID)] };
  if (from.type === 'target') {
    // The drag left an INPUT handle → the added node becomes the wire's SOURCE. A drag off a
    // `param:<key>` row keeps that row; otherwise route by the ADDED node's kind.
    const paramPort = toPortOf(from.handleId);
    const toPort = voice.paramKeyOf(paramPort) !== null ? paramPort : kind === 'modifier' ? 'mod' : undefined;
    return canConnect(probe, PROBE_ID, from.nodeId, undefined, toPort);
  }
  if (voice.isModSourceKind(fromKind)) {
    return canConnect(probe, from.nodeId, PROBE_ID, from.handleId ?? undefined, PROBE_PARAM);
  }
  return canConnect(probe, from.nodeId, PROBE_ID, from.handleId ?? undefined, fromKind === 'modifier' ? 'mod' : undefined);
}

/** The subset of `types` the pending wire can actually land on — the palette's list while a
    released drag holds a wire. EMPTY means nothing this wire could reach, so the popover is not
    opened at all and the drag simply cancels, exactly as it does today. */
export function typesForPendingWire<T extends { kind: NodeKind }>(
  graph: TriggerGraph,
  from: PendingWire,
  types: readonly T[],
): readonly T[] {
  return types.filter((t) => acceptsPendingWire(graph, from, t.kind));
}
