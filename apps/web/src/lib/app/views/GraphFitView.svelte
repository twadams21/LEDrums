<script lang="ts">
  /* Fits a graph canvas to its pane — on mount (after the resizable Author docks
     settle, a double-rAF so the flex/grid container has reached its final height +
     the nodes are measured) and again whenever `watch` changes, so switching to
     another graph re-centres its nodes instead of leaving them in a corner of the
     previous graph's viewport. The boolean `fitView` prop on <SvelteFlow> runs on
     init, which can land before the container has its final size (clamping zoom to
     minZoom and parking the graph in a corner) — this re-fit corrects that. A child
     of <SvelteFlow> so it can reach the flow instance via useSvelteFlow. `onfitted`
     fires once the fit has been applied, so a view can reveal its canvas only after
     it's correctly framed (no swap flash).

     Shared by the Patch + Trigger graphs (#9): Patch passes only `padding`; the
     Trigger graph also passes `watch` (the selected graph key) + `onfitted`. */
  import { useSvelteFlow } from '@xyflow/svelte';

  let {
    padding = 0.2,
    watch,
    onfitted,
  }: { padding?: number; watch?: unknown; onfitted?: () => void } = $props();
  const flow = useSvelteFlow();

  $effect(() => {
    watch; // re-fit when the watched key (selected graph) switches
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
