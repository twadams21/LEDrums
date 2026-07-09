<script lang="ts">
  /* Graph lint strip (R05 / GH #84) — a persistent surface on the trigger-graph canvas that
     renders the render-plan compiler's issues (`compileRenderPlan().issues`) as short, plain,
     act-on-it rows. Complementary to R03's transient wire toasts: those flash a rejected gesture,
     this stays up while the graph has a structural problem and names the fix. Absent (renders
     nothing) when there are no issues.

     Presentational: takes already-compiled issues and maps them to display copy via the pure
     `lintEntries` seam. Warn family (amber), not the red fault callout — this guides authoring,
     it doesn't alarm. Each row rides an icon + text so the tone never lives in colour alone. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { voice } from '@ledrums/core';
  import { lintEntries } from './graph-lint';

  let { issues }: { issues: readonly voice.RenderPlanIssue[] } = $props();

  const entries = $derived(lintEntries(issues));
</script>

{#if entries.length > 0}
  <div class="lint-strip" role="status" aria-label="Graph issues">
    {#each entries as entry (entry.code + (entry.nodeId ?? '') + (entry.detail ?? ''))}
      <div class="lint-row">
        <TriangleAlert size={13} class="lint-glyph" aria-hidden="true" />
        <p class="lint-copy">
          <span class="lint-problem">{entry.problem}.</span>
          <span class="lint-action">{entry.action}</span>
          {#if entry.detail}<span class="lint-detail">{entry.detail}</span>{/if}
        </p>
      </div>
    {/each}
  </div>
{/if}

<style>
  .lint-strip {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-width: min(100%, 420px);
    padding: var(--space-1);
    border: 1px solid color-mix(in oklch, var(--warn) 45%, transparent);
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--warn) 12%, var(--surface-3));
    box-shadow:
      0 1px 2px color-mix(in oklch, black 18%, transparent),
      0 8px 24px color-mix(in oklch, black 22%, transparent);
    /* Enter is a gentle fade+rise that collapses to instant under reduced motion (--dur-*). */
    animation: lint-in var(--dur-220) var(--ease-out-quart);
  }
  .lint-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-2);
  }
  .lint-strip :global(.lint-glyph) {
    flex: none;
    color: var(--warn);
    /* optical: drop the triangle onto the problem's cap height */
    margin-top: 2px;
  }
  .lint-copy {
    margin: 0;
    min-width: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }
  .lint-problem {
    color: var(--text);
    font-weight: 550;
  }
  .lint-action {
    color: var(--text-muted);
  }
  .lint-detail {
    display: block;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    overflow-wrap: anywhere;
  }
  @keyframes lint-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lint-strip {
      animation: none;
    }
  }
</style>
