<script lang="ts">
  /* Settings › Drums & Hoops (S4b) — kit geometry, re-homed from the Patch graph's
     kit / drum / hoop inspectors: kit-wide geometry defaults (setKitGlobal, mirror
     among them — it is a world reflection, geometry, not a controller setting), then one
     collapsible card per drum (DrumSection → setDrumTransform + per-hoop setHoopConfig /
     identifyHoop). Reads the AUTHORITATIVE routing straight from the project
     (outputsToPatch(kit.outputs)) for the hoop pixel-span read-outs; a read-only viewer
     gets the Inspector's natively-disabled-fieldset treatment. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Field from '../../../ui/Field.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import ReadRow from '../../docks/inspectors/ReadRow.svelte';
  import PaneHeader from '../PaneHeader.svelte';
  import { onNum } from '../../docks/inspectors/forms';
  import { totalKitPixelCount } from '../../docks/patch-inspector';
  import { outputsToPatch } from '../../patch-routing';
  import DrumSection from './DrumSection.svelte';

  let { store }: { store: TriggerLab } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const routing = $derived(kit ? outputsToPatch(kit.outputs) : { outputs: [] });
  const mirror = $derived(kit?.global.mirror ?? 'none');

  const MIRROR_OPTS = [
    { value: 'none', label: 'None' },
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
  ];
</script>

<fieldset class="pane-body" disabled={!store.canEdit}>
  <PaneHeader id="drums" />
  {#if kit}
    {@const g = kit.global}
    <section class="defaults" aria-label="Kit defaults">
      <Eyebrow>Kit defaults</Eyebrow>
      <p class="grouphint">Kit-wide geometry defaults. Per-drum geometry lives on each drum below.</p>
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
      <!-- variant="group": a <label> wrapper would forward a click on "Mirror" to the
           segmented control's FIRST button, silently resetting mirror to None. -->
      <Field layout="row" label="Mirror" hint="geometry-only world reflection" variant="group">
        <SegmentedControl
          value={mirror}
          options={MIRROR_OPTS}
          disabled={!project}
          onChange={(v) => store.setKitGlobal({ mirror: v as 'none' | 'x' | 'y' })}
          ariaLabel="Kit mirror axis"
        />
      </Field>
      <ReadRow label="Drums" value={String(kit.drums.length)} />
      <ReadRow label="Total pixels" value={`${totalKitPixelCount(kit)} px`} />
    </section>

    <section class="drums" aria-label="Drums">
      <Eyebrow>Drums</Eyebrow>
      {#each kit.drums as drum (drum.id)}
        <DrumSection {store} {drum} {kit} {routing} />
      {/each}
    </section>
  {:else}
    <p class="hint">Offline — drum and hoop settings appear when a show is loaded.</p>
  {/if}
</fieldset>

<style>
  /* fieldset reset — it carries the read-only viewer gate but must lay out like a div. */
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
  }
  /* Read-only viewer: the mirror control is div/role-based (bits-ui toggle group), so the
     native fieldset[disabled] gate can't reach it — stop it explicitly. */
  .pane-body:disabled :global(.seg) {
    pointer-events: none;
    opacity: 0.6;
  }
  .defaults,
  .drums {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .grouphint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
