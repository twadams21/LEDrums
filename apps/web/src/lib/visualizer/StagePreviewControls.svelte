<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import type { CameraPreset, PreviewPresentation } from './stage-camera';
  import type { StageQuality } from './stage-resources';

  let {
    presentation = $bindable<PreviewPresentation>('pixels'),
    camera = $bindable<CameraPreset>('overview'),
    quality = $bindable<StageQuality>('eco'),
    onReset, empty = false,
  }: {
    presentation?: PreviewPresentation; camera?: CameraPreset; quality?: StageQuality;
    onReset?: () => void; empty?: boolean;
  } = $props();
  const presentations = [{ value: 'pixels', label: 'Pixels' }, { value: 'stage', label: 'Stage' }];
  const cameras = [
    { value: 'overview', label: '3D overview' }, { value: 'audience', label: 'Audience' },
    { value: 'front', label: 'Front' }, { value: 'top', label: 'Top' },
  ];
  const qualities = [{ value: 'eco', label: 'Eco' }, { value: 'detail', label: 'Detail' }];
</script>

<div class="preview-controls" role="group" aria-label="Stage preview controls" data-shot="stage-preview-controls">
  <div class="camera-row">
    <SegmentedControl value={presentation} options={presentations} onChange={(v) => presentation = v as PreviewPresentation} ariaLabel="Preview presentation" />
    <!-- Four wordy camera names cannot segment in a narrow dock. The portaled Select keeps
         its fixed column and ellipsis instead of widening/clipping the canvas. -->
    <Select value={camera} options={cameras} onChange={(v) => camera = v as CameraPreset} ariaLabel="Camera view" segment={false} disabled={empty} />
    <IconButton icon={RotateCcw} label="Reset camera" onclick={onReset} disabled={empty} tooltipSide="bottom" />
  </div>
  <div class="detail-row">
    <p>{presentation === 'stage' ? 'Acrylic kit · live LED RGB' : 'Pixel RGB · no simulated spill'}</p>
    <div class="quality" class:inactive={presentation !== 'stage'} aria-hidden={presentation !== 'stage' ? 'true' : undefined}>
      <SegmentedControl value={quality} options={qualities} onChange={(v) => quality = v as StageQuality} ariaLabel="Stage quality" disabled={presentation !== 'stage'} />
    </div>
  </div>
</div>

<style>
  .preview-controls {
    --control-icon-size: 40px;
    --control-h: 40px;
    min-width: 0;
    padding: var(--space-2);
    background: var(--surface);
    box-shadow: 0 1px 0 var(--border-faint);
  }
  .camera-row { display: grid; grid-template-columns: auto minmax(0, 1fr) 40px; gap: var(--space-1); align-items: center; }
  .detail-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 40px; }
  .detail-row p { margin: 0; font-size: var(--text-2xs); color: var(--text-muted); text-wrap: pretty; line-height: var(--leading-snug); }
  .quality { flex-shrink: 0; }
  /* Reserve exactly the same width/height: changing presentation never resizes the camera. */
  .quality.inactive { visibility: hidden; }
  .preview-controls :global(.seg-btn) { min-height: 40px; min-width: 40px; padding: var(--space-1) var(--space-2); color: var(--text-muted); }
  .preview-controls :global(.seg-btn[data-state='on']) { color: var(--on-accent); }
  .preview-controls :global(.sel-lead) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: block; }
  .preview-controls :global(.sel-caret) { flex-shrink: 0; }
  .preview-controls :global(.ib:active), .preview-controls :global(.sel-trigger:active) { scale: 0.96; }
  @media (prefers-reduced-motion: reduce) {
    .preview-controls :global(button) { transition: none; }
    .preview-controls :global(button:active) { scale: 1; }
  }
</style>
