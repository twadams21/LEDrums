<script lang="ts">
  /* Drum Kit holder zone (C2/LDR-12) — the kit-global editor. The four kit-wide geometry
     defaults (LED density, hoops/drum, hoop spacing, max px/output) commit through P1's
     store.setKitGlobal; drum count and the whole-kit pixel total are derived read-outs. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import ReadRow from './ReadRow.svelte';
  import RenameField from './RenameField.svelte';
  import { onNum } from './forms';
  import { totalKitPixelCount } from '../patch-inspector';

  let { store, nodeId, title }: { store: TriggerLab; nodeId: string; title: string } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const drumCount = $derived(kit?.drums.length ?? 0);
  const totalPixels = $derived(kit ? totalKitPixelCount(kit) : 0);
</script>

{#if kit}
  {@const g = kit.global}
  <p class="section">Kit globals</p>
  <p class="grouphint">Kit-wide geometry defaults. Per-drum geometry lives on each drum sub-zone.</p>
  <Field layout="row" label="LED density" hint="px / m">
    <CommitInput
      type="number"
      min={0}
      value={g.ledDensityPxPerM ?? ''}
      disabled={!project}
      ariaLabel="LED density (px/m)"
      onCommit={(v) => onNum(v, (n) => store.setKitGlobal({ ledDensityPxPerM: n }))}
    />
  </Field>
  <Field layout="row" label="Hoops / drum" hint="kit default">
    <CommitInput
      type="number"
      min={1}
      value={g.hoopCount ?? ''}
      disabled={!project}
      ariaLabel="Hoops per drum"
      onCommit={(v) => onNum(v, (n) => store.setKitGlobal({ hoopCount: n }))}
    />
  </Field>
  <Field layout="row" label="Hoop spacing" hint="mm between hoops">
    <CommitInput
      type="number"
      min={0}
      value={g.defaultHoopSpacingMm ?? ''}
      disabled={!project}
      ariaLabel="Default hoop spacing (mm)"
      onCommit={(v) => onNum(v, (n) => store.setKitGlobal({ defaultHoopSpacingMm: n }))}
    />
  </Field>
  <Field layout="row" label="Max px / output" hint="per physical output">
    <CommitInput
      type="number"
      min={1}
      value={g.maxPixelsPerOutput ?? ''}
      disabled={!project}
      ariaLabel="Max pixels per output"
      onCommit={(v) => onNum(v, (n) => store.setKitGlobal({ maxPixelsPerOutput: n }))}
    />
  </Field>

  <p class="section">Totals</p>
  <ReadRow label="Drums" value={String(drumCount)} />
  <ReadRow label="Total pixels" value={`${totalPixels} px`} />
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
  .section:not(:first-child) {
    margin-top: var(--space-3);
  }
  .grouphint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
