<script lang="ts">
  /* Warn-toned inspector callout for a node's render-plan lint finding (R05 lint surface, extended
     to reachability in R15): a triangle glyph, the plain problem statement, and the one next step.
     Warn — never the red fault alarm — because it guides authoring rather than reporting a crash.
     Copy comes from the shared lint tables (graph-lint.ts), so a finding reads identically on the
     lint strip, the node badge, and here. Purely presentational: the inspector derives the anchored
     entries (compiled UNCACHED, per the render-plan cache contract) and passes problem/action in. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { problem, action }: { problem: string; action: string } = $props();
</script>

<div class="lint-callout" role="status">
  <TriangleAlert size={14} class="lc-glyph" aria-hidden="true" />
  <p class="lc-copy">
    <span class="lc-problem">{problem}.</span>
    <span class="lc-action">{action}</span>
  </p>
</div>

<style>
  /* Mirrors the graph lint strip's row so the surfaces read as one system; the tone never lives in
     colour alone (glyph + text). */
  .lint-callout {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid color-mix(in oklch, var(--warn) 45%, transparent);
    border-radius: var(--radius-2);
    background: color-mix(in oklch, var(--warn) 12%, var(--surface-3));
  }
  .lint-callout :global(.lc-glyph) {
    flex: none;
    color: var(--warn);
    margin-top: 1px;
  }
  .lc-copy {
    margin: 0;
    min-width: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }
  .lc-problem {
    color: var(--text);
    font-weight: 550;
  }
  .lc-action {
    color: var(--text-muted);
  }
</style>
