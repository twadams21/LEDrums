<script lang="ts">
  /* Test-only harness for MasterDetail: drives the primitive with real {#snippet} blocks
     (the same shape SectionsView / ObjectsView will adopt in S2.2) so the component test can
     prove that selecting in the rail reactively changes which detail renders. Not shipped UI —
     excluded from the build, imported solely by MasterDetail.test.ts. */
  import MasterDetail from './MasterDetail.svelte';

  // Passthroughs let the test exercise MasterDetail's own props; undefined falls back to the
  // primitive's own defaults (Svelte applies destructured defaults for undefined values).
  let { railWidth, railLabel = 'Object types' }: { railWidth?: string; railLabel?: string } =
    $props();

  const options = ['songs', 'effects', 'graphs'];
  let selected = $state('songs');
</script>

<MasterDetail bind:selected {railLabel} {railWidth}>
  {#snippet master({ selected: sel, select })}
    {#each options as opt (opt)}
      <button data-testid={`opt-${opt}`} aria-pressed={sel === opt} onclick={() => select(opt)}>
        {opt}
      </button>
    {/each}
  {/snippet}
  {#snippet detail({ selected: sel })}
    <span data-testid="detail-current">{sel ?? 'none'}</span>
  {/snippet}
</MasterDetail>
