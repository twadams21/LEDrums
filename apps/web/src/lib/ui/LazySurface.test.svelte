<script lang="ts">
  import LazySurface from './LazySurface.svelte';
  import type { LazyResource } from './lazy-resource.svelte';
  let { resource, label = 'Editor' }: { resource: LazyResource<string>; label?: string } = $props();
</script>

<LazySurface {resource} {label}>
  {#snippet children(value)}<p data-testid="loaded">{value}</p>{/snippet}
</LazySurface>
