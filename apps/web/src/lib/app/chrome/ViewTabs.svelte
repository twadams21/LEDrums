<script lang="ts">
  /* The workspace view tabs (tabbed chrome): Perform · Objects · Sections ·
     Trigger Graph · Monitor. Patch is deliberately absent — the whole patch lives
     in Settings now. Drives the shell's view router; the active tab is the one
     surface-raised, bordered pill. */
  import type { ShellStore } from '../shell-store.svelte';
  import type { View } from '../shell-nav';
  import type { Component } from 'svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import Boxes from '@lucide/svelte/icons/boxes';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Terminal from '@lucide/svelte/icons/terminal';

  let { shell }: { shell: ShellStore } = $props();

  const TABS: Array<{ id: View; label: string; icon: Component }> = [
    { id: 'perform', label: 'Perform', icon: Radio },
    { id: 'objects', label: 'Objects', icon: Boxes },
    { id: 'sections', label: 'Sections', icon: LayoutGrid },
    { id: 'trigger', label: 'Trigger Graph', icon: Workflow },
    { id: 'monitor', label: 'Monitor', icon: Terminal },
  ];
</script>

<nav class="tabs" aria-label="Views">
  {#each TABS as t (t.id)}
    <button
      type="button"
      class="tab"
      class:on={shell.view === t.id}
      aria-current={shell.view === t.id ? 'page' : undefined}
      onclick={() => shell.setView(t.id)}
    >
      <t.icon size={14} aria-hidden="true" />
      {t.label}
    </button>
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    transition-property: color, background-color;
    transition-duration: var(--dur-150);
  }
  .tab:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .tab.on {
    background: var(--surface-3);
    color: var(--ink);
    border-color: var(--border);
  }
</style>
