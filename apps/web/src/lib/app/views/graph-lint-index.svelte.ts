/* Reactive lint index for the Trigger Graph's xyflow nodes (R06 / GH #85).

   The lint strip renders the whole finding list; each offending node also wears a badge for
   the SAME finding. xyflow renders node components as descendants of <SvelteFlow>, so — like
   `GraphHover` — the view hands this class down via context and a `TriggerNode` reads its own
   badge reactively (`forNode(id)` reads the `$state` map) instead of freezing findings into
   xyflow `data`. The view keeps the map in sync from the one compiled issue list, so strip
   and badges can never disagree. */

import type { LintEntry } from './graph-lint';

export const GRAPH_LINT_KEY = Symbol('ledrums.graph-lint');

export class GraphLintIndex {
  /** Anchored findings grouped by node id — the source both the strip and badges read. */
  byNode = $state<Map<string, LintEntry[]>>(new Map());

  set(byNode: Map<string, LintEntry[]>): void {
    this.byNode = byNode;
  }

  /** The findings anchored to this node (empty when clean) — drives its badge + tooltip. */
  forNode(id: string): LintEntry[] {
    return this.byNode.get(id) ?? [];
  }
}
