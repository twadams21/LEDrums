<script lang="ts">
  /* Author left rail: the view navigation (top) over the section list (bottom).
     View buttons drive the shell's workspace router; the active view is
     accent-bordered. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { View } from '../shell-nav';
  import type { Component } from 'svelte';
  import SongRail from './SongRail.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Cable from '@lucide/svelte/icons/cable';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Radio from '@lucide/svelte/icons/radio';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Navigation from '@lucide/svelte/icons/navigation';
  import Terminal from '@lucide/svelte/icons/terminal';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const NAV: Array<{ id: View; label: string; icon: Component; sub?: string }> = [
    { id: 'perform', label: 'Perform', icon: Radio },
    { id: 'objects', label: 'Objects', icon: Boxes },
    { id: 'sections', label: 'Sections', icon: LayoutGrid },
    { id: 'trigger', label: 'Trigger Graph', icon: Workflow },
    { id: 'patch', label: 'Patch Graph', icon: Cable, sub: 'inputs · devices' },
    { id: 'monitor', label: 'Monitor', icon: Terminal },
  ];
</script>

<div class="rail">
  <nav class="views" aria-label="Views">
    <PanelHeader icon={Navigation} title="Views" />
    <div class="views-body">
      {#each NAV as v (v.id)}
        <ListItem
          icon={v.icon}
          label={v.label}
          secondary={v.sub}
          active={shell.view === v.id}
          onclick={() => shell.setView(v.id)}
        />
      {/each}
    </div>
  </nav>

  <section class="songs">
    <SongRail {store} />
  </section>
</div>

<style>
  .rail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--shell-gap);
    min-height: 0;
    height: 100%;
  }
  .songs {
    min-height: 0;
    overflow: hidden;
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
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .views-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
  }
</style>
