<script lang="ts">
  /* Drum Kit holder zone (D1) — kit-global read-outs. A landing surface for the v2 canvas'
     Kit-zone selection; the richer kit-globals editing arrives with the C-wave inspectors. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import ReadRow from './ReadRow.svelte';
  import RenameField from './RenameField.svelte';

  let { store, nodeId, title }: { store: TriggerLab; nodeId: string; title: string } = $props();

  const kit = $derived<KitConfig | null>(store.project?.kit ?? null);
  const drumCount = $derived(kit?.drums.length ?? 0);
</script>

{#if kit}
  <p class="section">Kit globals</p>
  <ReadRow label="Drums" value={String(drumCount)} />
  <ReadRow label="LED density" value={`${kit.global.ledDensityPxPerM} px/m`} />
  <ReadRow label="Hoops / drum" value={String(kit.global.hoopCount)} />
  <ReadRow label="Max px / output" value={String(kit.global.maxPixelsPerOutput)} />
  <p class="hint">Kit-global geometry defaults. Per-drum geometry lives on each drum sub-zone.</p>
  <RenameField {store} {nodeId} fallback={title} />
{/if}

<style>
  .section {
    margin: 0 0 var(--space-2);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
