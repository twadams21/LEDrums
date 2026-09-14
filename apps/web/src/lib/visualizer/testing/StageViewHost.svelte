<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import StageViewProbe from './StageViewProbe.svelte';
  let { active, ...props }: ComponentProps<typeof StageViewProbe> & { active: boolean } = $props();
</script>
{#if active}<StageViewProbe {...props} />{:else}<div>Pixels</div>{/if}
