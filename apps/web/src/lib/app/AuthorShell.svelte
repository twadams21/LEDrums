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
  import Splitter from '../ui/Splitter.svelte';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import LayersIcon from '@lucide/svelte/icons/layers';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const DOCK_TABS = [
    { value: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
    { value: 'monitor', label: 'Monitor', icon: Terminal },
  ];

  // Resizable layout tracks — sizes live in store.paneSizes (persisted live) with
  // sensible defaults + clamps. Keys are namespaced so Perform's panes don't clash.
  const RAIL = { key: 'authorRailW', def: 220, min: 168, max: 380 };
  const DOCK = { key: 'authorDockW', def: 360, min: 300, max: 560 };
  const BOTTOM = { key: 'authorBottomH', def: 148, min: 96, max: 360 };
  const railW = $derived(store.paneSizes[RAIL.key] ?? RAIL.def);
  const dockW = $derived(store.paneSizes[DOCK.key] ?? DOCK.def);
  const bottomH = $derived(store.paneSizes[BOTTOM.key] ?? BOTTOM.def);
  const setPane = (key: string, v: number): void => {
    store.paneSizes = { ...store.paneSizes, [key]: v };
  };
</script>

<div class="author" style="--rail-w:{railW}px; --dock-w:{dockW}px; --bottom-h:{bottomH}px;">
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

  <!-- Resize handles, positioned on the grid divides (direct children of .author so
       they paint above the panes — their ≥40px hit areas overhang each side). -->
  <Splitter
    orientation="vertical"
    size={railW}
    min={RAIL.min}
    max={RAIL.max}
    onResize={(v) => setPane(RAIL.key, v)}
    label="Resize left rail"
    style="top:var(--content-top); bottom:var(--pad); left:calc(var(--pad) + var(--rail-w) + var(--gap) / 2); transform:translateX(-50%);"
  />
  <Splitter
    orientation="vertical"
    invert
    size={dockW}
    min={DOCK.min}
    max={DOCK.max}
    onResize={(v) => setPane(DOCK.key, v)}
    label="Resize right dock"
    style="top:var(--content-top); bottom:var(--pad); right:calc(var(--pad) + var(--dock-w) + var(--gap) / 2); transform:translateX(50%);"
  />
  <Splitter
    orientation="horizontal"
    invert
    size={bottomH}
    min={BOTTOM.min}
    max={BOTTOM.max}
    onResize={(v) => setPane(BOTTOM.key, v)}
    label="Resize layers dock"
    style="left:calc(var(--pad) + var(--rail-w) + var(--gap)); right:calc(var(--pad) + var(--dock-w) + var(--gap)); bottom:calc(var(--pad) + var(--bottom-h) + var(--gap) / 2); transform:translateY(50%);"
  />
</div>

<style>
  .author {
    /* layout constants — single source for the grid tracks AND the splitter
       placement math below, so the resize handles stay on the divides. */
    --pad: var(--space-3);
    --gap: var(--space-3);
    --topbar: 58px;
    --content-top: calc(var(--pad) + var(--topbar) + var(--gap));
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: var(--rail-w, 220px) minmax(0, 1fr) var(--dock-w, 360px);
    grid-template-rows: var(--topbar) minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'rail center dock';
    gap: var(--gap);
    padding: var(--pad);
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
    grid-template-rows: minmax(0, 1fr) var(--bottom-h, 148px);
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
