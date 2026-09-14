<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type Scene from '../Scene.svelte';
  let { model, frame, presentation, camera, quality, reset }: ComponentProps<typeof Scene> = $props();
</script>
<div data-testid="scene" data-count={model?.count} data-frame={frame?.[0]} data-presentation={presentation} data-camera={camera} data-quality={quality} data-reset={reset}></div>
