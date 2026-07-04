<script lang="ts">
  /* Hands the SvelteFlow instance up to the owning view. Must be a CHILD of
     <SvelteFlow> (useSvelteFlow reads context), but the consumers — the Node
     Editor drawer's Add tab, keyboard placement — live OUTSIDE the flow, so this
     tiny bridge reports the instance up once on mount. Same pattern as
     GraphFitView (the other useSvelteFlow child). */
  import { onMount } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';

  export type FlowApi = ReturnType<typeof useSvelteFlow>;

  let { onflow }: { onflow: (flow: FlowApi) => void } = $props();

  const flow = useSvelteFlow(); // must run during init (context read)
  onMount(() => onflow(flow));
</script>
