<script lang="ts">
  /* The unified shell (tabbed chrome, approved variant C). Mode-less: it is simply
     whichever view is selected. Rows: nav bar (brand · view tabs · identity/status)
     · setlist songs bar · sections bar · workspace · bottom bar (Transport ·
     read-only engine stats). The workspace keeps the full-height right column
     (Kit preview pinned ↑ + Buses/Layers ↓) beside the active view; the **Perform
     view** hides the right column and fills the row for a focused performance
     layout. There is no Patch tab — the whole patch lives in Settings (see
     settings/SettingsModal, routed by the shell store). */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import TopBar from './chrome/TopBar.svelte';
  import SongsBar from './chrome/SongsBar.svelte';
  import SectionsBar from './chrome/SectionsBar.svelte';
  import Transport from './chrome/Transport.svelte';
  import OutputPill from './chrome/OutputPill.svelte';
  import StatusBar from '../trigger-lab/StatusBar.svelte';
  import LayersDock from './docks/LayersDock.svelte';
  import Visualizer from './docks/Visualizer.svelte';
  import Monitor from './docks/Monitor.svelte';
  import TriggerGraphView from './views/TriggerGraphView.svelte';
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
  // workspace row with PerformView.
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
  const COL2 = { key: 'authorDockW', def: 340, min: 280, max: 560 };
  // The visualiser's height at the top of the right column — the Buses/Layers panel
  // below it takes the remaining space (minmax(0,1fr)).
  const VIZ = { key: 'authorVizH', def: 280, min: 180, max: 620 };
  const col2W = $derived(store.paneSizes[COL2.key] ?? COL2.def);
  const vizH = $derived(store.paneSizes[VIZ.key] ?? VIZ.def);
  const setPane = (key: string, v: number): void => {
    store.paneSizes = { ...store.paneSizes, [key]: v };
  };
</script>

<div class="author" class:solo={perform} style="--col2-w:{col2W}px; --viz-h:{vizH}px;">
  <div class="top"><TopBar {store} {shell} /></div>

  <div class="songs"><SongsBar {store} /></div>

  <div class="sections"><SectionsBar {store} /></div>

  {#if perform}
    <main class="center">
      <PerformView {store} {shell} />
    </main>
  {:else}
    <main class="center">
      {#if shell.view === 'trigger'}
        <TriggerGraphView {store} {shell} />
      {:else if shell.view === 'objects'}
        <ObjectsView {store} {shell} />
      {:else if shell.view === 'monitor'}
        <Monitor {store} variant="workspace" />
      {:else}
        <SectionsView {store} {shell} />
      {/if}
    </main>

    <aside class="col2">
      <section class="viz"><Visualizer {store} variant="panel" /></section>
      <section class="buses">
        <PanelHeader icon={LayersIcon} title="Buses / Layers" />
        <LayersDock {store} {shell} />
      </section>
    </aside>
  {/if}

  <!-- Bottom bar: transport (left) + read-only engine stats (right). Presence /
       takeover deliberately live in the TOP bar — this row never asks for a click. -->
  <footer class="bottom">
    <Transport {store} />
    <span class="statuses">
      <StatusBar {store} />
      <OutputPill {store} />
    </span>
  </footer>

  <!-- Resize handles, positioned on the grid divides (direct children of .author so
       they paint above the panes — their ≥40px hit areas overhang each side). The
       right-column handles only exist when the column is rendered (not in Perform). -->
  {#if !perform}
    <Splitter
      orientation="vertical"
      invert
      size={col2W}
      min={COL2.min}
      max={COL2.max}
      onResize={(v) => setPane(COL2.key, v)}
      label="Resize right column"
      style="top:var(--content-top); bottom:var(--content-bottom); right:calc(var(--pad) + var(--col2-w) + var(--gap) / 2); transform:translateX(50%);"
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
    --topbar: 46px;
    --songbar: 38px;
    --sectionbar: 38px;
    --bottombar: 46px;
    /* the workspace row sits below THREE chrome rows (nav · songs · sections) and
       above the bottom bar — keep these in sync with grid-template-rows below so
       the splitter handles land on the divides. */
    --content-top: calc(
      var(--pad) + var(--topbar) + var(--gap) + var(--songbar) + var(--gap) + var(--sectionbar) + var(--gap)
    );
    --content-bottom: calc(var(--pad) + var(--bottombar) + var(--gap));
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--col2-w, 340px);
    grid-template-rows: var(--topbar) var(--songbar) var(--sectionbar) minmax(0, 1fr) var(--bottombar);
    grid-template-areas:
      'top top'
      'songs songs'
      'sections sections'
      'center col2'
      'bottom bottom';
    gap: var(--gap);
    padding: var(--pad);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  /* Perform: no right column — the workspace row is the single full-width track. */
  .author.solo {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'top'
      'songs'
      'sections'
      'center'
      'bottom';
  }
  .top {
    grid-area: top;
    min-width: 0;
  }
  .songs {
    grid-area: songs;
    min-width: 0;
  }
  .sections {
    grid-area: sections;
    min-width: 0;
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
  .bottom {
    grid-area: bottom;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .statuses {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
    min-width: 0;
  }
</style>
