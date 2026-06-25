<script lang="ts">
  /* Fixed-width vertical panel: a title header (optionally collapsible) over a
     scrollable body. Inline (not overlay) — use for persistent side rails. */
  import type { Snippet } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  type Props = {
    title?: string;
    width?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    side?: 'left' | 'right';
    class?: string;
    actions?: Snippet;
    children: Snippet;
  };

  let {
    title,
    width = '260px',
    collapsible = false,
    collapsed = $bindable(false),
    side = 'left',
    class: klass,
    actions,
    children,
  }: Props = $props();
</script>

<aside
  class={['sidebar', `side-${side}`, klass]}
  class:collapsed
  style="width:{collapsed ? 'auto' : width}"
>
  {#if title || actions}
    <header class="sb-head">
      {#if collapsible}
        <button class="sb-toggle" type="button" onclick={() => (collapsed = !collapsed)} aria-label={collapsed ? 'Expand' : 'Collapse'} aria-expanded={!collapsed}>
          <ChevronDown size={14} aria-hidden="true" class="sb-chev" />
        </button>
      {/if}
      {#if title && !collapsed}<span class="sb-title">{title}</span>{/if}
      <span class="sb-spacer"></span>
      {#if actions && !collapsed}{@render actions()}{/if}
    </header>
  {/if}
  {#if !collapsed}
    <div class="sb-body">{@render children()}</div>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .sb-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
    background: var(--surface-2);
  }
  .sb-title {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .sb-spacer {
    flex: 1;
  }
  .sb-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--text-faint);
    border-radius: var(--radius-1);
  }
  .sb-toggle:hover {
    color: var(--ink);
    background: var(--surface-inset);
  }
  .sidebar :global(.sb-chev) {
    transition: rotate 150ms ease;
  }
  .sidebar.collapsed :global(.sb-chev) {
    rotate: -90deg;
  }
  .sb-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
  }
</style>
