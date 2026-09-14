<script lang="ts">
  import { Canvas, T } from '@threlte/core';
  import { Grid } from '@threlte/extras';
  import Pixels from './Pixels.svelte';
  import Stage from './Stage.svelte';
  import PreviewCamera from './PreviewCamera.svelte';
  import type { SerializedModel } from '../ws/protocol-types';
  import { buildStageLayout, SCENE_SCALE } from './stage-geometry';
  import type { CameraPreset, PreviewPresentation } from './stage-camera';
  import { stageDpr, type StageQuality } from './stage-resources';
  import { STAGE_LOADING, type StageStatus } from './stage-view.svelte';

  let stageStatus = $state<StageStatus>(STAGE_LOADING);

  let { model, frame, dim = false, presentation = 'pixels', camera = 'overview', quality = 'eco', reset = 0 }: {
    model: SerializedModel | null; frame: Uint8Array | null; dim?: boolean;
    presentation?: PreviewPresentation; camera?: CameraPreset; quality?: StageQuality; reset?: number;
  } = $props();

  let lastModel: SerializedModel | null | undefined;
  let lastLayout: ReturnType<typeof buildStageLayout>;
  function geometry(m: SerializedModel | null) {
    if (m !== lastModel) { lastModel = m; lastLayout = buildStageLayout(m); }
    return lastLayout;
  }
  const layout = $derived(geometry(model));
  const stage = $derived(presentation === 'stage');
</script>

<div class="viz" class:dim data-presentation={presentation} data-shot="stage-preview-canvas">
  <Canvas dpr={stage ? stageDpr(quality) : 1} shadows={false}>
    <T.Color attach="background" args={[stage ? '#040609' : '#050609']} />
    <PreviewCamera center={layout.center} size={layout.size} halfExtents={layout.halfExtents} preset={camera} {reset} />

    {#if stage}
      <T.HemisphereLight args={['#ceddf1', '#11151d', 1.5]} />
      <T.DirectionalLight position={[layout.center[0] - 10, layout.center[1] + 18, layout.center[2] + 12]} color="#dfebff" intensity={2.5} />
      <T.DirectionalLight position={[layout.center[0] + 8, layout.center[1] + 6, layout.center[2] - 10]} color="#889ec2" intensity={1.8} />
      {#if model && model.count}<Stage {model} {frame} {quality} onStatus={(status) => stageStatus = status} />{/if}
    {:else}
      <Grid position={[layout.center[0], layout.floorY, layout.center[2]]} cellColor="#1c2230" sectionColor="#2a3344" sectionSize={5} cellSize={1} fadeDistance={layout.size * 8} infiniteGrid />
      {#if model}<Pixels {model} {frame} scale={SCENE_SCALE} />{/if}
    {/if}
  </Canvas>
  {#if !model || model.count === 0}
    <div class="empty" role="status">
      <span>{model ? 'No pixels in this kit' : 'Waiting for kit geometry'}</span>
      <small>{model ? 'Add drums and hoops in Settings to preview them.' : 'The preview appears when a kit is available.'}</small>
    </div>
  {:else if stage && stageStatus.kind !== 'ready'}
    <p class="stage-status" role="status" aria-live="polite">{stageStatus.message}</p>
  {/if}
</div>

<style>
  .viz { position: absolute; inset: 0; z-index: var(--z-base); transition: filter var(--dur-220) var(--ease-control); }
  .viz.dim { filter: brightness(0.35) saturate(0.4); }
  .empty { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: var(--space-2); padding: var(--space-4); pointer-events: none; color: var(--text); text-align: center; }
  .empty small, .stage-status { color: var(--text-muted); font-size: var(--text-xs); text-wrap: pretty; }
  .stage-status { position: absolute; bottom: var(--space-2); left: var(--space-2); right: var(--space-2); margin: 0; padding: var(--space-2); background: var(--surface); max-height: 35%; overflow: auto; line-height: var(--leading-snug); }
  @media (prefers-reduced-motion: reduce) { .viz { transition: none; } }
</style>
