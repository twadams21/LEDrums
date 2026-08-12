<script lang="ts">
  /* The unassigned-hoops pool — every kit hoop on no chain, as warning-toned chips.
     Read-only by design: this IS the `hoop-uncovered` indicator ("indicators, not
     restrictions") — an unwired hoop is legal, it just stays dark. Hoops leave via a
     card's add-picker and return here on remove, both by pure derivation. */
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import { hoopKey } from './chain-editor';
  import type { HoopRef } from '../../patch-routing';

  let { pool, hoopLabel }: { pool: HoopRef[]; hoopLabel: (h: HoopRef) => string } = $props();
</script>

<section class="pool" aria-label="Unassigned hoops">
  <Eyebrow>Unassigned hoops</Eyebrow>
  {#if pool.length}
    <p class="phint">On no output chain — these hoops will stay dark.</p>
    <div class="chips">
      {#each pool as h (hoopKey(h))}
        <span class="chip">{hoopLabel(h)}</span>
      {/each}
    </div>
  {:else}
    <p class="phint">Every hoop is routed.</p>
  {/if}
</section>

<style>
  .pool {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .phint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    padding: 3px var(--space-2);
    border: 1px solid color-mix(in oklch, var(--warn) 35%, transparent);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    color: color-mix(in oklch, var(--warn) 80%, var(--text));
    background: color-mix(in oklch, var(--warn) 8%, transparent);
    white-space: nowrap;
  }
</style>
