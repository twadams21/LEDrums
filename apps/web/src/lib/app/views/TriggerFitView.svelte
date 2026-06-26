<script lang="ts">
  /* Fits the Trigger graph to the pane — on mount (after the resizable Author docks
     settle, same double-rAF as PatchFitView) and again whenever `watch` changes, so
     switching to another pad/graph re-centres its nodes instead of leaving them off
     in a corner of the previous graph's viewport. A child of <SvelteFlow> so it can
     reach the flow instance. `onfitted` fires once the fit has been applied, so the
     view can reveal the canvas only after it's correctly framed (no swap flash). */
  import { useSvelteFlow } from '@xyflow/svelte';

  let {
    padding = 0.2,
    watch,
    onfitted,
  }: { padding?: number; watch?: unknown; onfitted?: () => void } = $props();
  const flow = useSvelteFlow();

  $effect(() => {
    watch; // re-fit when the selected graph switches
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        flow.fitView({ padding }); // applies the viewport synchronously (no duration)
        onfitted?.();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });
</script>
