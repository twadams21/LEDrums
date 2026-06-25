<script lang="ts">
  /* Kit preview — 3D stage ⇄ 2D pixel map, off one SegmentedControl. Shows the
     REAL server LED output when the engine link is open (and a frame has arrived),
     else the local sim composite, so offline === local preview. Reused by the
     Author right-dock (pinned) and the Perform split. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Scene from '../../visualizer/Scene.svelte';
  import Pixels2D from '../../visualizer/Pixels2D.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Box from '@lucide/svelte/icons/box';

  let {
    store,
    mode = $bindable<'3d' | '2d'>('3d'),
    label = 'Kit preview',
    showToggle = true,
  }: {
    store: TriggerLab;
    mode?: '3d' | '2d';
    label?: string;
    showToggle?: boolean;
  } = $props();

  // store.previewFrame + store.model swap together (server when connected, else
  // local) so the frame always matches the model it's painted on.
  const PREVIEW_OPTS = [
    { value: '3d', label: '3D' },
    { value: '2d', label: '2D' },
  ];
</script>

<div class="viz">
  {#if label}<Eyebrow icon={Box} class="viz-label">{label}</Eyebrow>{/if}
  {#if showToggle}
    <span class="viz-toggle">
      <SegmentedControl value={mode} options={PREVIEW_OPTS} onChange={(v) => (mode = v as '3d' | '2d')} ariaLabel="Preview mode" />
    </span>
  {/if}
  {#if mode === '3d'}
    <Scene model={store.model} frame={store.previewFrame} />
  {:else}
    <Pixels2D model={store.model} frame={store.previewFrame} />
  {/if}
</div>

<style>
  .viz {
    position: relative;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg-perform);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .viz :global(.viz-label) {
    position: absolute;
    top: var(--space-2);
    left: var(--space-3);
    z-index: 1;
    pointer-events: none;
    color: var(--text-faint);
  }
  .viz-toggle {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 1;
  }
</style>
