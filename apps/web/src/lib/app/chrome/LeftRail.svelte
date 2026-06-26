<script lang="ts">
  /* Author left rail: the view navigation (top) over the section list (bottom).
     View buttons drive the shell's workspace router; the active view is
     accent-bordered. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { View } from '../shell-nav';
  import type { Component } from 'svelte';
  import SongRail from './SongRail.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Cable from '@lucide/svelte/icons/cable';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Radio from '@lucide/svelte/icons/radio';
  import Navigation from '@lucide/svelte/icons/navigation';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const NAV: Array<{ id: View; label: string; icon: Component; sub?: string }> = [
    { id: 'trigger', label: 'Trigger Graph', icon: Workflow },
    { id: 'patch', label: 'Patch Graph', icon: Cable, sub: 'inputs · devices' },
    { id: 'sections', label: 'Sections', icon: LayoutGrid },
    { id: 'perform', label: 'Perform', icon: Radio },
  ];
</script>

<div class="rail">
  <nav class="views" aria-label="Views">
    <Eyebrow icon={Navigation}>Views</Eyebrow>
    {#each NAV as v (v.id)}
      {@const I = v.icon}
      <button
        class="navitem"
        class:active={shell.view === v.id}
        aria-pressed={shell.view === v.id}
        onclick={() => shell.setView(v.id)}
      >
        <I size={16} aria-hidden="true" />
        <span class="labels">
          <span class="lab">{v.label}</span>
          {#if v.sub}<span class="sub">{v.sub}</span>{/if}
        </span>
      </button>
    {/each}
  </nav>

  <section class="songs">
    <SongRail {store} />
  </section>
</div>

<style>
  .rail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .songs {
    min-height: 0;
    overflow: hidden;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    display: flex;
  }
  .songs :global(.songrail) {
    flex: 1;
    min-height: 0;
  }
  .views {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .views :global(.eyebrow) {
    margin-bottom: var(--space-1);
  }
  .navitem {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: left;
  }
  .navitem:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .navitem.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  .navitem.active :global(svg) {
    color: var(--accent);
  }
  .navitem :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .labels {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    min-width: 0;
  }
  .lab {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
