<script lang="ts" module>
  /** The one piece of the store this view needs besides the authoring api: the persisted pane sizes. */
  export interface PaneSizeHost {
    paneSizes: Record<string, number>;
  }
</script>

<script lang="ts">
  /* The Effects view (effect chains, S06a) — the shell's `trigger` editor view. The Grid on top, a
     resizable splitter, the device strip below (Ableton's Device View). The visualiser and dock
     column stay in the shell's right column. The strip height persists in `paneSizes` like every
     other pane size.

     Everything reads and edits through `api` (EffectsAuthoringApi); `panes` is only the pane-size
     record, so the view never depends on the store class. */
  import type { EffectsAuthoringApi } from '../../../trigger-lab/effects-api';
  import PanelHeader from '../../../ui/PanelHeader.svelte';
  import Splitter from '../../../ui/Splitter.svelte';
  import Blend from '@lucide/svelte/icons/blend';
  import EffectsGrid from './grid/EffectsGrid.svelte';
  import DeviceStrip from './strip/DeviceStrip.svelte';

  let { api, panes }: { api: EffectsAuthoringApi; panes: PaneSizeHost } = $props();

  // def fits one side-by-side column whole: bar + Play bar + header (two lines when it wraps) + a 240px device row.
  const STRIP = { key: 'effectsStripH', min: 160, max: 640, def: 440 };
  const stripH = $derived(panes.paneSizes[STRIP.key] ?? STRIP.def);
  const setStripH = (v: number): void => {
    panes.paneSizes = { ...panes.paneSizes, [STRIP.key]: v };
  };
</script>

<div class="effects-view" style:--strip-h={`${stripH}px`}>
  <section class="pane grid-pane" aria-label="Effects grid">
    <PanelHeader icon={Blend} title="Effects">
      <span class="hint" aria-hidden="true"><kbd>1</kbd>–<kbd>0</kbd> audition</span>
    </PanelHeader>
    <div class="grid-scroll">
      <EffectsGrid {api} />
    </div>
  </section>

  <section class="pane strip-pane" aria-label="Device strip">
    <DeviceStrip {api} cell={api.selectedCell} />
  </section>

  <!-- On the grid↔strip divide. Inverted: the strip is anchored to the bottom, so dragging up grows it. -->
  <Splitter
    orientation="horizontal"
    invert
    size={stripH}
    min={STRIP.min}
    max={STRIP.max}
    label="Resize device strip"
    onResize={setStripH}
    style="left: 0; right: 0; bottom: calc(var(--strip-h) + var(--shell-gap) / 2); transform: translateY(50%);"
  />
</div>

<style>
  .effects-view {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) var(--strip-h);
    gap: var(--shell-gap);
    height: 100%;
    min-height: 0;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .grid-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--surface-2);
    box-shadow: 0 1px 0 var(--border);
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-muted);
  }
</style>
