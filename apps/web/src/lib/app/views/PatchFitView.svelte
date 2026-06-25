<script lang="ts">
  /* Re-fits the Patch graph once the pane has actually laid out. The boolean
     `fitView` prop on <SvelteFlow> runs on init, which can land before the flex/grid
     canvas (inside the resizable Author docks) reaches its final height — fitting a
     short container clamps the zoom to minZoom and parks the graph in a corner. As a
     child of <SvelteFlow>, this can reach the flow instance via useSvelteFlow and
     re-fit after a double rAF (container settled + nodes measured). */
  import { useSvelteFlow } from '@xyflow/svelte';

  let { padding = 0.15 }: { padding?: number } = $props();
  const flow = useSvelteFlow();

  $effect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => void flow.fitView({ padding }));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>
