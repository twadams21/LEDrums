/* Pure view-model for the `reset` node's target picker — DOM-free / rune-free, like
   objects-view / patch-inspector, so the option building + labelling is unit-testable in node.

   A reset addresses its target as (graph key, node id) because that pair is stable across the
   MANY eval-state prefixes one authored node runs under (see `isResetStateKey` in core). The UI's
   job is to turn that opaque pair into something a performer can pick and read back.

   Sequence nodes carry no `label` of their own (GraphNode has no name field), so they are
   numbered per graph in canvas reading order — top-to-bottom, then left-to-right, then by id so
   two nodes at the same point keep a stable order across reloads. Renumbering is by POSITION, so
   moving a node on the canvas can change its display number; the stored target is the node ID and
   never moves with it. */
import type { GraphNode, TriggerGraph } from '../../trigger-lab/sim';

/** One selectable sequence node, already labelled for a dropdown. */
export interface ResetTargetOption {
  graphKey: string;
  nodeId: string;
  /** The owning graph's display label (`store.graphLabel`). */
  graphLabel: string;
  /** "Sequence 1", "Sequence 2", … within that graph. */
  nodeLabel: string;
}

/** Canvas reading order: top-to-bottom, then left-to-right, then id for a stable tiebreak. */
function byCanvasOrder(a: GraphNode, b: GraphNode): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/** The sequence nodes of ONE graph, in canvas order, numbered from 1. */
export function sequenceNodesOf(graph: TriggerGraph | undefined): { nodeId: string; nodeLabel: string }[] {
  if (!graph) return [];
  return graph.nodes
    .filter((n) => n.kind === 'sequence')
    .sort(byCanvasOrder)
    .map((n, i) => ({ nodeId: n.id, nodeLabel: `Sequence ${i + 1}` }));
}

/**
 * Every resettable sequence node across every graph, for the target picker. Graphs with no
 * sequence node are omitted entirely — there is nothing to reset in them, and listing them would
 * make the graph dropdown mostly dead ends. Graph order follows `graphKeys` (the caller passes the
 * store's key order, so the list matches the rest of the UI).
 */
export function resetTargetOptions(
  graphs: Record<string, TriggerGraph>,
  graphKeys: readonly string[],
  graphLabel: (key: string) => string,
): ResetTargetOption[] {
  const out: ResetTargetOption[] = [];
  for (const graphKey of graphKeys) {
    for (const { nodeId, nodeLabel } of sequenceNodesOf(graphs[graphKey])) {
      out.push({ graphKey, nodeId, graphLabel: graphLabel(graphKey), nodeLabel });
    }
  }
  return out;
}

/**
 * The reset node's card sub-line / inspector read-back.
 *
 * Three honest states, because a target can rot underneath the node: unset (never picked), missing
 * (the graph or node it names is gone — say so rather than rendering a raw id the user can't act
 * on), and resolved. A missing target is a silent no-op at eval time, so the UI is the only place
 * that failure is visible.
 */
export function describeResetTarget(
  node: Pick<GraphNode, 'targetGraphKey' | 'targetNodeId'>,
  options: readonly ResetTargetOption[],
): string {
  const { targetGraphKey, targetNodeId } = node;
  if (!targetGraphKey || !targetNodeId) return 'no target';
  const hit = options.find((o) => o.graphKey === targetGraphKey && o.nodeId === targetNodeId);
  if (!hit) return 'target missing';
  return `${hit.graphLabel} · ${hit.nodeLabel}`;
}

/**
 * The reset node's card sub-line: its target, prefixed with its OWN input when it has one.
 *
 * Whether a reset is self-hosted is the single most consequential thing about it on the canvas —
 * a bound one is an independent entry point that ignores the graph's Trigger, an unbound one fires
 * inline — so the binding leads. `describeSource` is injected (the shared `describeTriggerSource`)
 * to keep this module free of the kit/drum lookups that helper needs.
 */
export function describeResetNode(
  node: Pick<GraphNode, 'targetGraphKey' | 'targetNodeId' | 'source'>,
  options: readonly ResetTargetOption[],
  describeSource: (source: GraphNode['source']) => string,
): string {
  const target = describeResetTarget(node, options);
  return node.source ? `${describeSource(node.source)} → ${target}` : target;
}
