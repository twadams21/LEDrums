<script lang="ts">
  /* Kit preview — 3D Pixels/actual acrylic Stage ⇄ 2D pixel map. Shows the
     REAL server LED output when the engine link is open (and a frame has arrived),
     else the local sim composite, so offline === local preview. Reused by the
     Author right-dock (pinned) and the Perform split.

     Two chrome variants:
     · 'panel'   — a docked panel with a PanelHeader bar (title + mode toggle in the
                   trail); matches its Buses/Layers sibling in the right column.
     · 'overlay' — a bare canvas with a small floating label; used by Perform where
                   two previews sit side by side and chrome should stay minimal. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Scene from '../../visualizer/Scene.svelte';
  import Pixels2D from '../../visualizer/Pixels2D.svelte';
  import StagePreviewControls from '../../visualizer/StagePreviewControls.svelte';
  import type { CameraPreset, PreviewPresentation } from '../../visualizer/stage-camera';
  import type { StageQuality } from '../../visualizer/stage-resources';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Box from '@lucide/svelte/icons/box';

  let {
    store,
    mode = $bindable<'3d' | '2d'>('3d'),
    label = 'Kit preview',
    showToggle = true,
    variant = 'overlay',
  }: {
    store: Pick<TriggerLab, 'model' | 'previewFrame'>;
    mode?: '3d' | '2d';
    label?: string;
    showToggle?: boolean;
    variant?: 'panel' | 'overlay';
  } = $props();

  // Presentation is local view state, never authored or sent to the engine.
  let presentation = $state<PreviewPresentation>('pixels');
  let camera = $state<CameraPreset>('overview');
  let quality = $state<StageQuality>('eco');
  let reset = $state(0);

  // store.previewFrame + store.model swap together (server when connected, else
  // local) so the frame always matches the model it's painted on.
  const PREVIEW_OPTS = [
    { value: '3d', label: '3D' },
    { value: '2d', label: '2D' },
  ];
</script>

<div class="viz" class:panel={variant === 'panel'}>
  {#if variant === 'panel'}
    <PanelHeader icon={Box} title={label}>
      {#if showToggle}
        <SegmentedControl value={mode} options={PREVIEW_OPTS} onChange={(v) => (mode = v as '3d' | '2d')} ariaLabel="Preview mode" />
      {/if}
    </PanelHeader>
  {:else}
    <div class="viz-head">
      {#if label}<Eyebrow icon={Box}>{label}</Eyebrow>{/if}
      {#if showToggle}
        <SegmentedControl value={mode} options={PREVIEW_OPTS} onChange={(v) => (mode = v as '3d' | '2d')} ariaLabel="Preview mode" />
      {/if}
    </div>
  {/if}
  <div class="viz-stage" class:three={mode === '3d'}>
    {#if mode === '3d'}
      <StagePreviewControls bind:presentation bind:camera bind:quality onReset={() => reset++} empty={!store.model?.count} />
    {/if}
    <div class="canvas">
      {#if mode === '3d'}
        <Scene model={store.model} frame={store.previewFrame} {presentation} {camera} {quality} {reset} />
      {:else}
        <Pixels2D model={store.model} frame={store.previewFrame} />
      {/if}
    </div>
  </div>
</div>

<style>
  .viz {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg-perform);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  /* Panel variant: header row + stage below (mirrors the Buses/Layers panel grid). */
  .viz.panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--surface);
  }
  .viz-stage {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .viz-stage.three { grid-template-rows: auto minmax(0, 1fr); }
  .canvas { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
  .viz.panel .viz-stage {
    background: var(--bg-perform);
  }
  .viz-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
  }
</style>
