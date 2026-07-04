<script lang="ts">
  /* Panel title bar — THE header treatment for docked panels and drawers, promoted
     from the tabbed Inspector/Monitor header (its scale, icon size, and weight won
     the title-style unification; Eyebrow is retired as a panel title and stays a
     small in-content label only). Fixed-height row: accent-tinted icon + label on
     the left, a trailing snippet on the right for the panel's controls (tabs,
     toggles, add buttons). */
  import type { Component, Snippet } from 'svelte';

  let {
    icon,
    title,
    children,
  }: {
    icon?: Component;
    title: string;
    /** Trailing controls (right-aligned): tabs, segmented switches, icon buttons. */
    children?: Snippet;
  } = $props();
</script>

<header class="panel-hd">
  <span class="pt">
    {#if icon}{@const I = icon}<I size={14} aria-hidden="true" />{/if}
    <span class="label">{title}</span>
  </span>
  {#if children}<span class="trail">{@render children()}</span>{/if}
</header>

<style>
  .panel-hd {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 38px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .pt {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
  }
  .pt :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }
</style>
