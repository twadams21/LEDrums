<script lang="ts">
  /* Collapsible section — an eyebrow-styled summary row with a chevron and an optional count,
     over a native <details> so keyboard, find-in-page and assistive tech get it for free.
     `open` is $bindable, so the caller owns the memory (per-session store, persisted record,
     or nothing at all) rather than this primitive inventing a persistence surface. */
  import type { Snippet } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  type Props = {
    label: string;
    /** Shown right-aligned in the summary — usually how many rows are inside. */
    count?: number;
    open?: boolean;
    onToggle?: (open: boolean) => void;
    class?: string;
    children: Snippet;
  };

  let { label, count, open = $bindable(true), onToggle, class: klass, children }: Props = $props();
</script>

<details
  class={['disclosure', klass]}
  {open}
  ontoggle={(e) => {
    const next = e.currentTarget.open;
    if (next === open) return;
    open = next;
    onToggle?.(next);
  }}
>
  <summary>
    <ChevronRight size={13} class="chev" aria-hidden="true" />
    <span class="dlabel">{label}</span>
    {#if count !== undefined}<span class="count">{count}</span>{/if}
  </summary>
  <div class="dbody">{@render children()}</div>
</details>

<style>
  .disclosure {
    border-top: 1px solid var(--border-faint);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    list-style: none;
    user-select: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    transition: color var(--dur-120) ease, background-color var(--dur-120) ease;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--ink);
    background: var(--surface-2);
  }
  summary :global(.chev) {
    flex: none;
    color: var(--text-faint);
    transition: rotate var(--dur-120) var(--ease-control);
  }
  .disclosure[open] summary :global(.chev) {
    rotate: 90deg;
  }
  .dlabel {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    margin-left: auto;
    flex: none;
    text-transform: none;
    letter-spacing: normal;
    font-variant-numeric: tabular-nums;
    color: var(--text-disabled);
  }
  @media (prefers-reduced-motion: reduce) {
    summary :global(.chev) {
      transition: none;
    }
  }
</style>
