/* Reachability lint (R07, GH #86) — the render-plan compiler's static check for wired branches
   that render nothing because they never connect a layer source to the terminal Output anchor.

   Two states, both structural (wiring only — no params):
   - `no-path-to-output`: a layer PRODUCER (effect/play) whose forward flow never reaches the
     Output node. The classic unwired/torn-off render leaf — nothing it emits can ever land.
   - `dead-branch`: a flow transform/collector (scope/mix/output) that DOES reach Output but has
     no producer upstream — a branch wired toward the anchor with nothing to render. Anchored to
     the topmost such node of each branch (where a producer should attach), so a producerless
     chain lights one badge, not one per node.

   Producers are `effect`/`play`; the flow-chain layer carriers are `scope` (transform) and
   `mix`/`output` (collectors). `modifier` and modulation sources sit off the flow (they wire to
   `mod`/`param` ports, never `in`), so they are neither producers nor layer carriers here.

   Purely structural — it reads only node kinds and flow edges, never params — so unlike
   `empty-scope` its findings can NEVER go param-stale in the R18 plan cache (see the invariant
   comment on `renderPlanSignature`). Pure + framework-free: a function of the compiled flow
   graph, unit-tested without a DOM. */

import type { GraphEdge, GraphNode } from './types';
import type { RenderPlanChild, RenderPlanIssue } from './render-plan';

/** Layer producers — the only nodes that SEED a layer into the flow. */
function isProducer(node: GraphNode): boolean {
  return node.kind === 'effect' || node.kind === 'play';
}

/** Flow-chain nodes that CARRY/COLLECT a layer and so need one upstream (scope narrows; mix and
    output collect). Off-flow kinds (modifier, modulation sources, routers, trigger) are excluded. */
function needsLayerInput(node: GraphNode): boolean {
  return node.kind === 'scope' || node.kind === 'mix' || node.kind === 'output';
}

/**
 * Flag wired branches that render nothing for a structural (wiring-only) reason:
 *  - a producer with no forward path to the Output anchor (`no-path-to-output`), and
 *  - the head of a branch that reaches Output but has no producer upstream (`dead-branch`).
 *
 * Gated on an Output existing — with none, `missing-output` (fatal) is the actionable message,
 * so this pass stays silent rather than double-reporting. Emits in node order for a stable list.
 */
export function detectUnreachable(
  nodesById: Map<string, GraphNode>,
  flowChildrenById: Map<string, RenderPlanChild[]>,
  incomingFlowEdgesById: Map<string, GraphEdge[]>,
  outputId: string | null,
): RenderPlanIssue[] {
  if (!outputId) return [];

  // Forward reachability to the Output anchor (memoised DFS; the cycle guard defers to the
  // separate flow-cycle lint, which reports the loop itself).
  const reachesOutput = new Map<string, boolean>();
  const canReachOutput = (id: string, onPath: Set<string>): boolean => {
    if (id === outputId) return true;
    const memo = reachesOutput.get(id);
    if (memo !== undefined) return memo;
    if (onPath.has(id)) return false;
    onPath.add(id);
    let ok = false;
    for (const child of flowChildrenById.get(id) ?? []) {
      if (canReachOutput(child.node.id, onPath)) {
        ok = true;
        break;
      }
    }
    onPath.delete(id);
    reachesOutput.set(id, ok);
    return ok;
  };

  // Is any layer PRODUCER upstream (reverse walk over flow edges)? Memoised; same cycle guard.
  const producerUpstream = new Map<string, boolean>();
  const hasProducerUpstream = (id: string, onPath: Set<string>): boolean => {
    const memo = producerUpstream.get(id);
    if (memo !== undefined) return memo;
    if (onPath.has(id)) return false;
    onPath.add(id);
    let ok = false;
    for (const edge of incomingFlowEdgesById.get(id) ?? []) {
      const parent = nodesById.get(edge.from);
      if (!parent) continue;
      if (isProducer(parent) || hasProducerUpstream(parent.id, onPath)) {
        ok = true;
        break;
      }
    }
    onPath.delete(id);
    producerUpstream.set(id, ok);
    return ok;
  };

  /** Is `id` the head of its producerless branch — i.e. no flow-parent is itself a layer carrier
      that also reaches Output with no producer? Keeps the badge on the one node where a producer
      should attach, instead of every node down the dead chain. */
  const isBranchHead = (id: string): boolean => {
    for (const edge of incomingFlowEdgesById.get(id) ?? []) {
      const parent = nodesById.get(edge.from);
      if (!parent) continue;
      if (needsLayerInput(parent) && !hasProducerUpstream(parent.id, new Set()) && canReachOutput(parent.id, new Set())) {
        return false;
      }
    }
    return true;
  };

  const issues: RenderPlanIssue[] = [];
  for (const node of nodesById.values()) {
    if (isProducer(node)) {
      if (!canReachOutput(node.id, new Set())) {
        issues.push({
          code: 'no-path-to-output',
          message: 'No flow path reaches the Output anchor — nothing this node emits can render.',
          nodeId: node.id,
        });
      }
    } else if (needsLayerInput(node) && (incomingFlowEdgesById.get(node.id)?.length ?? 0) > 0) {
      // A branch wired toward Output but with no producer to render. Require it to actually reach
      // Output (a live-looking path) and to be the branch head (one badge per dead branch). The
      // incoming-edge guard above skips an unwired node (e.g. a bare Output) — that is a
      // not-yet-authored state, not a dead branch.
      if (
        canReachOutput(node.id, new Set()) &&
        !hasProducerUpstream(node.id, new Set()) &&
        isBranchHead(node.id)
      ) {
        issues.push({
          code: 'dead-branch',
          message: 'No layer source upstream — this branch reaches Output but has nothing to render.',
          nodeId: node.id,
        });
      }
    }
  }
  return issues;
}
