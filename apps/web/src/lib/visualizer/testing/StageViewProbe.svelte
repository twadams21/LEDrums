<script lang="ts">
  import { untrack, type ComponentProps } from 'svelte';
  import type Stage from '../Stage.svelte';
  import { createStageView } from '../stage-view.svelte';
  let { model, quality, frame, environment }: ComponentProps<typeof Stage> & {
    environment?: Parameters<typeof createStageView>[1];
  } = $props();
  const view = createStageView(() => ({ model, quality }), untrack(() => environment));
  $effect(() => view.resources?.update(frame));
</script>
<div data-testid="stage-view" data-draws={view.resources?.group.children.length} data-state={view.status.kind} data-frame={frame?.[0]}>{view.status.message}</div>
