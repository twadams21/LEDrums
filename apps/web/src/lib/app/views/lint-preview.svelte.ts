/* Dev-only preview override for the R05 graph lint strip (GH #84).

   The lint strip renders `compileRenderPlan(selectedGraph).issues`. In the real app a
   well-formed graph is guaranteed a trigger + Output anchor and cycles are refused at wire
   time, so an issue-bearing state is hard to author — and `pnpm ui-shot` can't reach it the
   normal way. This tiny rune holder lets the screenshot seam (`shot-seam.ts`) pin a set of
   REAL compiler issues (built by compiling a degenerate graph) so the strip renders genuine
   compiler output for a capture. TriggerGraphView reads it ONLY under `import.meta.env.DEV`,
   so it is inert (and dead-code-eliminated) in production.

   Mirrors `wire-preview.svelte.ts` — the same drag/unreachable-state-for-a-shot pattern. */

import { voice } from '@ledrums/core';

class LintPreviewState {
  /** Pinned compiler issues for a capture, or null when not previewing. */
  current = $state<voice.RenderPlanIssue[] | null>(null);

  set(issues: voice.RenderPlanIssue[]): void {
    this.current = issues;
  }

  clear(): void {
    this.current = null;
  }
}

export const lintPreview = new LintPreviewState();
