<script lang="ts">
  /* The header line above a dense list: an uppercase mono label on the left, an optional
     mono count on the right, and room for one trailing control. The count is the point —
     "8 of 32" answers "is this list complete?" before the eye reaches the rows, which is
     what a list of hoops, zones or devices is usually being scanned for.

     Composes Eyebrow for the label so section labels stay one typographic idea. */
  import type { Snippet } from 'svelte';
  import Eyebrow from './Eyebrow.svelte';

  let {
    label,
    /** Right-aligned mono count, e.g. `4` or `3 of 16`. */
    count,
    /** Trailing control (an IconButton, a picker) — sits after the count. */
    action,
  }: { label: string; count?: string | number; action?: Snippet } = $props();
</script>

<div class="lhead">
  <Eyebrow>{label}</Eyebrow>
  <span class="spacer"></span>
  {#if count !== undefined}<span class="count">{count}</span>{/if}
  {#if action}{@render action()}{/if}
</div>

<style>
  .lhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .count {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
</style>
