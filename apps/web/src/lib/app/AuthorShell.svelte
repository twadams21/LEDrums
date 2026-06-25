<script lang="ts">
  /* Authoring Workbench. Mirrors the wireframe: top bar · left rail (songs +
     views) · center (workspace view ↑ + Layers/Buses dock ↓) · right dock
     (Visualizer pinned ↑ + tabbed Inspector ⇄ Monitor ↓). The workspace swaps on
     shell.view; the right-dock lower panel swaps on shell.dock. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import type { DockTab } from './shell-nav';
  import TopBar from './chrome/TopBar.svelte';
  import LeftRail from './chrome/LeftRail.svelte';
  import LayersDock from './docks/LayersDock.svelte';
  import Visualizer from './docks/Visualizer.svelte';
  import Inspector from './docks/Inspector.svelte';
  import Monitor from './docks/Monitor.svelte';
  import TriggerGraphView from './views/TriggerGraphView.svelte';
  import PatchGraphView from './views/PatchGraphView.svelte';
  import SectionsView from './views/SectionsView.svelte';
  import KitView from './views/KitView.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import LayersIcon from '@lucide/svelte/icons/layers';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const DOCK_TABS = [
    { value: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
    { value: 'monitor', label: 'Monitor', icon: Terminal },
  ];
</script>

<div class="author">
  <div class="top"><TopBar {store} {shell} /></div>

  <div class="rail"><LeftRail {store} {shell} /></div>

  <div class="center">
    <main class="workspace">
      {#if shell.view === 'trigger'}
        <TriggerGraphView {store} {shell} />
      {:else if shell.view === 'patch'}
        <PatchGraphView {store} {shell} />
      {:else if shell.view === 'sections'}
        <SectionsView {store} {shell} />
      {:else}
        <KitView {store} />
      {/if}
    </main>

    <section class="bottom">
      <header class="dockhead"><Eyebrow icon={LayersIcon}>Layers / Buses</Eyebrow></header>
      <LayersDock {store} {shell} />
    </section>
  </div>

  <aside class="dock">
    <section class="viz"><Visualizer {store} /></section>
    <div class="lower">
      <div class="tabstrip">
        <Tabs value={shell.dock} tabs={DOCK_TABS} onChange={(v) => shell.setDock(v as DockTab)} ariaLabel="Inspector or Monitor" />
      </div>
      <div class="panel">
        {#if shell.dock === 'inspector'}
          <Inspector {store} {shell} />
        {:else}
          <Monitor {store} />
        {/if}
      </div>
    </div>
  </aside>
</div>

<style>
  .author {
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) clamp(320px, 24vw, 380px);
    grid-template-rows: 58px minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'rail center dock';
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .top {
    grid-area: top;
    min-width: 0;
  }
  .rail {
    grid-area: rail;
    min-height: 0;
  }
  .center {
    grid-area: center;
    display: grid;
    grid-template-rows: minmax(0, 1fr) 148px;
    gap: var(--space-3);
    min-height: 0;
    min-width: 0;
  }
  .workspace {
    min-height: 0;
    min-width: 0;
  }
  .bottom {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .dockhead {
    padding: var(--space-2) var(--space-3) 0;
  }
  .dock {
    grid-area: dock;
    display: grid;
    grid-template-rows: minmax(180px, 1fr) minmax(0, 1.2fr);
    gap: var(--space-3);
    min-height: 0;
  }
  .viz {
    min-height: 0;
  }
  .lower {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .tabstrip {
    padding: var(--space-2) var(--space-3) 0;
  }
  .panel {
    min-height: 0;
    overflow: hidden;
  }
</style>
