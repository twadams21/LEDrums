<script lang="ts">
  /* Alignment guide overlay (Trigger graph). Draws the guide lines computed by align-guides.ts in
     FLOW coordinates via xyflow's ViewportPortal, so they pan/zoom with the canvas. Rendered inside
     GraphCanvas's flow (it needs the flow context); the view feeds it live guides during a drag and
     clears them on drop. Purely decorative — never intercepts pointer events. */
  import { ViewportPortal } from '@xyflow/svelte';
  import type { GuideLine } from './align-guides';

  let { guides }: { guides: ReadonlyArray<GuideLine> } = $props();
</script>

<ViewportPortal target="front">
  {#each guides as g, i (i)}
    {#if g.orient === 'v'}
      <div class="align-guide v" style:transform={`translate(${g.pos}px, ${g.from}px)`} style:height={`${g.to - g.from}px`}></div>
    {:else}
      <div class="align-guide h" style:transform={`translate(${g.from}px, ${g.pos}px)`} style:width={`${g.to - g.from}px`}></div>
    {/if}
  {/each}
</ViewportPortal>

<style>
  .align-guide {
    position: absolute;
    top: 0;
    left: 0;
    background: var(--accent);
    pointer-events: none;
    z-index: 6;
  }
  .align-guide.v {
    width: 1px;
  }
  .align-guide.h {
    height: 1px;
  }
</style>
