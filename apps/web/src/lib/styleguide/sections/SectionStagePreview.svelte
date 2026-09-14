<script lang="ts">
  import DemoCard from '../DemoCard.svelte';
  import StagePreviewControls from '../../visualizer/StagePreviewControls.svelte';
  import type { CameraPreset, PreviewPresentation } from '../../visualizer/stage-camera';
  import type { StageQuality } from '../../visualizer/stage-resources';
  let presentation = $state<PreviewPresentation>('stage');
  let camera = $state<CameraPreset>('overview');
  let quality = $state<StageQuality>('eco');
  let resets = $state(0);
</script>

<section class="block" id="stage-preview">
  <div class="block-head">
    <h2>Stage preview</h2>
    <p>Pixels is the diagnostic default. Stage shows the actual acrylic kit: clear walls, internal LED strips, pale heads and chrome hardware. Each hoop samples live pixel RGB; camera and quality remain local view settings.</p>
  </div>
  <DemoCard title="Preview controls · narrow dock" src="lib/visualizer/StagePreviewControls" note="40px controls; portaled camera choices; quality space stays reserved in Pixels. Eco uses transparent approximation at DPR 1; Detail uses transmission at DPR 1.5. No automatic camera motion. Loading, failed assets, missing body metadata or mismatched dimensions retain Pixels with a reason. Geometry is never stretched; no invented stands. Optical appearance is illustrative, not calibrated.">
    <div class="control-demo">
      <StagePreviewControls bind:presentation bind:camera bind:quality onReset={() => resets++} />
    </div>
    <p class="readout" aria-live="polite">{presentation} · {camera} · {quality} · camera resets {resets}</p>
  </DemoCard>
</section>

<style>
  .control-demo { width: min(100%, 340px); min-width: 0; }
  .readout { margin: 0; font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
</style>
