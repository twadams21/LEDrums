<script lang="ts">
  /* The unified shell (wave-3 re-layout, approved prototype). Mode-less: it is simply
     whichever view is selected. Top bar · transport bar · left rail (views + songs) ·
     center workspace · full-height right column (Kit preview pinned ↑ + Buses/Layers ↓).
     Node/device editing lives INSIDE the graph views (the Node Editor drawer); bus
     settings expand inline in the Buses panel; section settings inline in the Sections
     view — there is no global inspector dock. The **Perform view** hides the right
     column and fills the center for a focused performance layout; **Monitor** is a
     first-class workspace view. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import TopBar from './chrome/TopBar.svelte';
  import Transport from './chrome/Transport.svelte';
  import LeftRail from './chrome/LeftRail.svelte';
  import LayersDock from './docks/LayersDock.svelte';
  import Visualizer from './docks/Visualizer.svelte';
  import Monitor from './docks/Monitor.svelte';
  import TriggerGraphView from './views/TriggerGraphView.svelte';
  import PatchGraphView from './views/PatchGraphView.svelte';
  import SectionsView from './views/SectionsView.svelte';
  import ObjectsView from './views/ObjectsView.svelte';
  import PerformView from './views/PerformView.svelte';
  import PanelHeader from '../ui/PanelHeader.svelte';
  import Splitter from '../ui/Splitter.svelte';
  import ToastHost from '../ui/ToastHost.svelte';
  import PasteSongDialog from './views/PasteSongDialog.svelte';
  import PasteFallbackDialog from './views/PasteFallbackDialog.svelte';
  import LayersIcon from '@lucide/svelte/icons/layers';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // Perform is a chrome-light view: the shell hides the right column and fills the
  // center with PerformView.
  const perform = $derived(shell.view === 'perform');

  // Keep the selection consistent with the active model so an inspector surface never
  // shows stale info after the focus moves out from under it. The selection lives in the
  // shell store while the active song / section / graph live in the engine store — the
  // two are otherwise decoupled, so e.g. changing songs re-points `activeSectionId` (to
  // the new song's first section) without the section detail knowing. This bridge
  // re-syncs:
  //  · a SECTION selection follows the active section (song switch, recall);
  //  · a NODE selection is dropped once it no longer exists in the open graph (graph
  //    switch, node removed / swapped) so the inspector clears instead of describing a
  //    gone node.
  $effect(() => {
    const sel = shell.selection;
    if (!sel) return;
    if (sel.kind === 'section') {
      const active = store.activeSectionId;
      if (active && active !== sel.sectionId) shell.select({ kind: 'section', sectionId: active });
    } else if (sel.kind === 'node') {
      // Drop a node selection only when a graph IS open and the node is genuinely gone from
      // it. A transiently-null selectedGraph (mid graph-switch / store rebuild) must NOT
      // clear — that race made the Inspector lose a selection it should have kept (item 1.8);
      // while null the Inspector just resolves the node to nothing and shows its empty state.
      const g = store.selectedGraph;
      if (g && !g.nodes.some((n) => n.id === sel.nodeId)) shell.clearSelection();
    }
  });

  // Resizable layout tracks — sizes live in store.paneSizes (persisted live) with
  // sensible defaults + clamps.
  const RAIL = { key: 'authorRailW', def: 220, min: 168, max: 380 };
  const COL2 = { key: 'authorDockW', def: 340, min: 280, max: 560 };
  // The visualiser's height at the top of the right column — the Buses/Layers panel
  // below it takes the remaining space (minmax(0,1fr)).
  const VIZ = { key: 'authorVizH', def: 280, min: 180, max: 620 };
  const railW = $derived(store.paneSizes[RAIL.key] ?? RAIL.def);
  const col2W = $derived(store.paneSizes[COL2.key] ?? COL2.def);
  const vizH = $derived(store.paneSizes[VIZ.key] ?? VIZ.def);
  const setPane = (key: string, v: number): void => {
    store.paneSizes = { ...store.paneSizes, [key]: v };
  };
</script>

<div class="author" class:solo={perform} style="--rail-w:{railW}px; --col2-w:{col2W}px; --viz-h:{vizH}px;">
  <div class="top"><TopBar {store} /></div>

  <!-- Transport rides its own slim bar directly under the TopBar: a global
       performance control (play/tempo/velocity/panic) that stays put across every
       view — including Perform — instead of crowding the identity/status TopBar. -->
  <div class="xport"><Transport {store} /></div>

  <div class="rail"><LeftRail {store} {shell} /></div>

  {#if perform}
    <main class="center">
      <PerformView {store} {shell} />
    </main>
  {:else}
    <main class="center">
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

    <aside class="col2">
      <section class="viz"><Visualizer {store} /></section>
      <section class="buses">
        <PanelHeader icon={LayersIcon} title="Buses / Layers" />
        <LayersDock {store} {shell} />
      </section>
    </aside>
  {/if}

  <!-- Resize handles, positioned on the grid divides (direct children of .author so
       they paint above the panes — their ≥40px hit areas overhang each side). The
       rail handle is always live; the right-column handles only exist when the column
       is rendered (i.e. not in Perform). -->
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
      size={col2W}
      min={COL2.min}
      max={COL2.max}
      onResize={(v) => setPane(COL2.key, v)}
      label="Resize right column"
      style="top:var(--content-top); bottom:var(--pad); right:calc(var(--pad) + var(--col2-w) + var(--gap) / 2); transform:translateX(50%);"
    />
    <!-- the visualiser↔buses boundary inside the right column. Not inverted — the
         visualiser is anchored to the top, so dragging down grows its height. -->
    <Splitter
      orientation="horizontal"
      size={vizH}
      min={VIZ.min}
      max={VIZ.max}
      onResize={(v) => setPane(VIZ.key, v)}
      label="Resize visualiser"
      style="left:calc(100% - var(--pad) - var(--col2-w)); right:var(--pad); top:calc(var(--content-top) + var(--viz-h) + var(--gap) / 2); transform:translateY(-50%);"
    />
  {/if}

  <!-- Transient notifications (paste errors, confirmations) — one host for the whole shell. -->
  <ToastHost />

  <!-- Clipboard paste dialogs (store-driven, S44): song destination chooser + the manual
       paste-text fallback for graph/section when clipboard reads are blocked. -->
  <PasteSongDialog {store} />
  <PasteFallbackDialog {store} />
</div>

<style>
  .author {
    /* layout constants — single source for the grid tracks AND the splitter
       placement math below, so the resize handles stay on the divides. */
    --pad: var(--shell-gap);
    /* inter-module gutter — one knob (tokens.css › --shell-gap) drives the grid
       gap AND the nested gaps below, so the shell tightens uniformly. */
    --gap: var(--shell-gap);
    --topbar: 58px;
    --transport: 46px;
    /* content (rail/center/col2) starts below TWO chrome rows — TopBar + the
       transport bar — each followed by a grid gap. Keep this in sync with the
       grid-template-rows below so the splitter handles land on the divides. */
    --content-top: calc(var(--pad) + var(--topbar) + var(--gap) + var(--transport) + var(--gap));
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: var(--rail-w, 220px) minmax(0, 1fr) var(--col2-w, 340px);
    grid-template-rows: var(--topbar) var(--transport) minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'xport xport xport'
      'rail center col2';
    gap: var(--gap);
    padding: var(--pad);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  /* Perform: no right column — collapse to rail + center only. The transport bar
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
    min-height: 0;
    min-width: 0;
  }
  .col2 {
    grid-area: col2;
    display: grid;
    /* viz height is user-resizable (the visualiser↔buses rail); the Buses/Layers
       panel below takes what's left. */
    grid-template-rows: var(--viz-h, 280px) minmax(0, 1fr);
    gap: var(--gap);
    min-height: 0;
  }
  .viz {
    min-height: 0;
  }
  .buses {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
</style>
