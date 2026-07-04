<script lang="ts">
  /* A small tag/label pill. Two modes:
     - static (no `onclick`)  → a <span>, for read-only tag pills + count badges.
     - toggle (`onclick` set) → a <button> with a `selected` state, for filter chips.
     Token-driven, monospace label. Compose with Tooltip for a hover popover. */
  import type { Snippet } from 'svelte';

  type Props = {
    label?: string;
    /** When provided, the pill is an interactive toggle button (a filter chip). */
    onclick?: () => void;
    /** Selected (pressed) state for the toggle mode. */
    selected?: boolean;
    /** `accent` uses the accent-soft treatment; `plain` is a quiet neutral pill. */
    tone?: 'plain' | 'accent';
    title?: string;
    class?: string;
    children?: Snippet;
  };

  let { label, onclick, selected = false, tone = 'plain', title, class: klass, children }: Props = $props();
</script>

{#if onclick}
  <button
    type="button"
    class={['pill', 'pill-btn', `pill-${tone}`, klass]}
    class:sel={selected}
    aria-pressed={selected}
    {title}
    {onclick}
  >
    {#if children}{@render children()}{:else}{label}{/if}
  </button>
{:else}
  <span class={['pill', `pill-${tone}`, klass]} {title}>
    {#if children}{@render children()}{:else}{label}{/if}
  </span>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-label);
    line-height: 1.5;
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .pill-btn {
    cursor: pointer;
    transition-property: color, border-color, background-color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .pill-btn:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .pill-btn:active {
    scale: 0.96;
  }
  .pill-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-soft);
  }
  .pill-btn.sel {
    color: var(--on-accent);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .pill-accent {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 45%, transparent);
  }
</style>
