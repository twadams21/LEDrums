<script lang="ts">
  import { T, useTask, useThrelte } from '@threlte/core';
  import { untrack } from 'svelte';
  import type { SerializedModel } from '../ws/protocol-types';
  import { SCENE_SCALE } from './stage-geometry';
  import type { StageQuality } from './stage-resources';
  import { createStageView, type StageStatus } from './stage-view.svelte';
  import { createStageEnvironment } from './stage-environment';
  import Pixels from './Pixels.svelte';

  let { model, frame, quality, onStatus }: {
    model: SerializedModel; frame: Uint8Array | null; quality: StageQuality; onStatus?: (status: StageStatus) => void;
  } = $props();
  const { renderer } = useThrelte();
  const view = createStageView(() => ({ model, quality }), () => createStageEnvironment(renderer));
  useTask(() => view.resources?.update(frame));
  $effect(() => {
    const status = view.status;
    untrack(() => onStatus?.(status));
  });
</script>

<!-- Explicit ownership: snapshots share asset geometry, so Threlte must not dispose it. -->
{#if view.resources}<T is={view.resources.group} dispose={false} />{/if}
{#if !view.resources || view.resources.fallbacks.length}
  <Pixels {model} {frame} scale={SCENE_SCALE} excludeDrums={view.resources?.matchedDrums} />
{/if}
