<script lang="ts">
  /* The unified shell. Mode-less: it is simply whichever view is selected. Mirrors
     the wireframe: top bar · left rail (songs + views) · center (workspace view ↑ +
     Layers/Buses dock ↓) · right dock (Visualizer pinned ↑ + tabbed Inspector ⇄
     Monitor ↓). The workspace swaps on shell.view; the right-dock lower panel swaps
     on shell.dock. The **Perform view** is the exception: it hides the Layers/Buses
     drawer + the right dock and fills the center with PerformView for a focused
     performance layout. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import type { DockTab } from './shell-nav';
  import TopBar from './chrome/TopBar.svelte';
  import Transport from './chrome/Transport.svelte';
  import LeftRail from './chrome/LeftRail.svelte';
  import LayersDock from './docks/LayersDock.svelte';
  import Visualizer from './docks/Visualizer.svelte';
  import Inspector from './docks/Inspector.svelte';
  import Monitor from './docks/Monitor.svelte';
  import TriggerGraphView from './views/TriggerGraphView.svelte';
  import PatchGraphView from './views/PatchGraphView.svelte';
  import SectionsView from './views/SectionsView.svelte';
  import ObjectsView from './views/ObjectsView.svelte';
  import PerformView from './views/PerformView.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import Splitter from '../ui/Splitter.svelte';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Terminal from '@lucide/svelte/icons/terminal';
  import LayersIcon from '@lucide/svelte/icons/layers';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // Perform is a chrome-light view: the shell hides the Layers/Buses drawer + the
  // right Inspector/Monitor dock and fills the center with PerformView.
  const perform = $derived(shell.view === 'perform');
  const monitorWorkspace = $derived(shell.view === 'monitor');

  // Keep the Inspector's selection consistent with the active model so it never shows stale
  // info after the focus moves out from under it. The Inspector's deriveds are reactive, but
  // the selection lives in the shell store while the active song / section / graph live in the
  // engine store — the two are otherwise decoupled, so e.g. changing songs re-points
  // `activeSectionId` (to the new song's first section) without the section the Inspector still
  // shows knowing. This bridge re-syncs:
  //  · a SECTION selection follows the active section (song switch, recall);
  //  · a NODE selection is dropped once it no longer exists in the open graph (graph switch,
  //    node removed / swapped) so the Inspector clears instead of describing a gone node.
  $effect(() => {
    const sel = shell.selection;
    if (!sel) return;
    if (sel.kind === 'section') {
      const active = store.activeSectionId;
      if (active && active !== sel.sectionId) shell.select({ kind: 'section', sectionId: active });
    } else if (sel.kind === 'node') {
      const g = store.selectedGraph;
      if (!g || !g.nodes.some((n) => n.id === sel.nodeId)) shell.clearSelection();
    }
  });

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

<div class="author" class:solo={perform} style="--rail-w:{railW}px; --dock-w:{dockW}px; --bottom-h:{bottomH}px;">
  <div class="top"><TopBar {store} /></div>

  <!-- Transport rides its own slim bar directly under the TopBar: a global
       performance control (play/tempo/velocity/panic) that stays put across every
       view — including Perform — instead of crowding the identity/status TopBar. -->
  <div class="xport"><Transport {store} /></div>

  <div class="rail"><LeftRail {store} {shell} /></div>

  {#if perform}
    <main class="center solo-center">
      <PerformView {store} {shell} />
    </main>
  {:else}
    <div class="center" class:monitor-center={monitorWorkspace}>
      <main class="workspace">
        {#if shell.view === 'trigger'}
          <TriggerGraphView {store} {shell} />
        {:else if shell.view === 'patch'}
          <PatchGraphView {store} {shell} />
        {:else if shell.view === 'objects'}
          <ObjectsView {store} {shell} />
        {:else if shell.view === 'monitor'}
          <Monitor {store} variant="workspace" />
        {:else}
          <SectionsView {store} {shell} />
        {/if}
      </main>

      {#if !monitorWorkspace}
        <section class="bottom">
          <header class="dockhead"><Eyebrow icon={LayersIcon}>Layers / Buses</Eyebrow></header>
          <LayersDock {store} {shell} />
        </section>
      {/if}
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
  {/if}

  <!-- Resize handles, positioned on the grid divides (direct children of .author so
       they paint above the panes — their ≥40px hit areas overhang each side). The
       rail handle is always live; the dock + layers handles only exist when their
       panes are rendered (i.e. not in Perform). -->
  <Splitter
    orientation="vertical"
    size={railW}
    min={RAIL.min}
    max={RAIL.max}
    onResize={(v) => setPane(RAIL.key, v)}
    label="Resize left rail"
    style="top:var(--content-top); bottom:var(--pad); left:calc(var(--pad) + var(--rail-w) + var(--gap) / 2); transform:translateX(-50%);"
  />
  {#if !perform}
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
    {#if !monitorWorkspace}
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
    {/if}
  {/if}
</div>

<style>
  .author {
    /* layout constants — single source for the grid tracks AND the splitter
       placement math below, so the resize handles stay on the divides. */
    --pad: var(--space-3);
    --gap: var(--space-3);
    --topbar: 58px;
    --transport: 46px;
    /* content (rail/center/dock) starts below TWO chrome rows now — TopBar + the
       transport bar — each followed by a grid gap. Keep this in sync with the
       grid-template-rows below so the splitter handles land on the divides. */
    --content-top: calc(var(--pad) + var(--topbar) + var(--gap) + var(--transport) + var(--gap));
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: var(--rail-w, 220px) minmax(0, 1fr) var(--dock-w, 360px);
    grid-template-rows: var(--topbar) var(--transport) minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'xport xport xport'
      'rail center dock';
    gap: var(--gap);
    padding: var(--pad);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  /* Perform: no right dock — collapse to rail + center only. The transport bar
     stays (it's a performance control), spanning both remaining columns. */
  .author.solo {
    grid-template-columns: var(--rail-w, 220px) minmax(0, 1fr);
    grid-template-areas:
      'top top'
      'xport xport'
      'rail center';
  }
  .top {
    grid-area: top;
    min-width: 0;
  }
  .xport {
    grid-area: xport;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
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
  .center.monitor-center {
    grid-template-rows: minmax(0, 1fr);
  }
  /* Perform: the center is a single full-height region (no Layers/Buses row). */
  .center.solo-center {
    grid-template-rows: minmax(0, 1fr);
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
