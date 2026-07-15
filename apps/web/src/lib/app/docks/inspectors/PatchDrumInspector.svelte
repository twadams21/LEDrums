<script lang="ts">
  /* Patch drum node — the drum's geometry (origin / rotation / angles / spacing / diameter /
     flip) and swatch, written through the authoritative store mutators. No-op-safe while
     offline. Per-hoop pixel count now lives in the HOOP inspector (drum.hoops[] is authoritative);
     this view no longer edits pixels-per-hoop. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import { hexToHsv, hsvToHex, type Hsv, type KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import ColorSwatch from '../../../ui/ColorSwatch.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { boundTriggerFor, type PatchEditor } from '../patch-inspector';

  let { store, editor, nodeId, title }: {
    store: TriggerLab;
    editor: Extract<PatchEditor, { kind: 'drum' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const drum = $derived(kit?.drums.find((x) => x.id === editor.drumId) ?? null);

  // The drum's persisted hex swatch, surfaced through the HSV-based ColorSwatch primitive.
  // hsvToHex round-trips hexToHsv (see core/color), so read + write stay lossless.
  const swatch = $derived<Hsv>(hexToHsv(drum?.color ?? '#ffffff'));

  // Read-only: the trigger graph bound to this drum by identity, human-labelled when named.
  const bound = $derived(drum ? boundTriggerFor(drum.id, store.graphs) : null);
  const boundLabel = $derived(bound ? store.graphLabel(bound.graphKey) : null);

  function setAxis(drumId: string, field: 'origin' | 'rotation', axis: 'x' | 'y' | 'z', n: number): void {
    const d = kit?.drums.find((x) => x.id === drumId);
    if (d) store.setDrumTransform(drumId, { [field]: { ...d[field], [axis]: n } });
  }
</script>

{#if drum}
  <div class="vgroup">
    <span class="glabel">Origin <em>mm</em></span>
    <div class="axes">
      {#each ['x', 'y', 'z'] as const as ax (ax)}
        <CommitInput
          type="number"
          value={drum.origin[ax]}
          disabled={!project}
          suffix={ax}
          ariaLabel={`Origin ${ax}`}
          onCommit={(v) => onNum(v, (n) => setAxis(drum.id, 'origin', ax, n))}
        />
      {/each}
    </div>
  </div>
  <div class="vgroup">
    <span class="glabel">Rotation <em>deg</em></span>
    <div class="axes">
      {#each ['x', 'y', 'z'] as const as ax (ax)}
        <CommitInput
          type="number"
          value={drum.rotation[ax]}
          disabled={!project}
          suffix={ax}
          ariaLabel={`Rotation ${ax}`}
          onCommit={(v) => onNum(v, (n) => setAxis(drum.id, 'rotation', ax, n))}
        />
      {/each}
    </div>
  </div>
  <Field layout="row" label="Colour" hint="drum swatch">
    <ColorSwatch
      hue={swatch.h}
      saturation={swatch.s}
      brightness={swatch.v}
      disabled={!project}
      ariaLabel="Drum colour"
      onChange={(hsv) => store.setDrumTransform(drum.id, { color: hsvToHex(hsv.h, hsv.s, hsv.v) })}
    />
  </Field>
  <Field layout="row" label="Starting angle" hint="all 4 hoops">
    <CommitInput
      type="number"
      value={drum.startAngleDeg}
      disabled={!project}
      suffix="°"
      ariaLabel="Starting angle"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { startAngleDeg: n }))}
    />
  </Field>
  <Field layout="row" label="Spin" hint="rotates pixel 0 around the hoop">
    <CommitInput
      type="number"
      value={drum.localSpinDeg}
      disabled={!project}
      suffix="°"
      ariaLabel="Spin"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { localSpinDeg: n }))}
    />
  </Field>
  <Field layout="row" label="Hoop spacing" hint="vertical gap between hoops">
    <CommitInput
      type="number"
      min={1}
      value={drum.hoopSpacingMm}
      disabled={!project}
      suffix="mm"
      ariaLabel="Hoop spacing"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { hoopSpacingMm: n }))}
    />
  </Field>
  <Field layout="row" label="Diameter" hint="drum size — sets ring radius">
    <CommitInput
      type="number"
      min={1}
      value={drum.diameterIn}
      disabled={!project}
      suffix="in"
      ariaLabel="Diameter"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { diameterIn: n }))}
    />
  </Field>
  <Field layout="row" label="Flip drum" hint="rotate in place — mirror skins + reverse chase">
    <Toggle
      pressed={drum.flip ?? false}
      disabled={!project}
      ariaLabel="Flip drum"
      onLabel="flipped"
      offLabel="normal"
      onChange={(v) => store.setDrumTransform(drum.id, { flip: v })}
    />
  </Field>
  <ReadRow label="Bound trigger" value={boundLabel ?? bound?.label ?? '—'} />
  <RenameField {store} {nodeId} fallback={title} />
{/if}

<style>
  .vgroup {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .glabel {
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .glabel em {
    font-style: normal;
    color: var(--text-faint);
    margin-left: var(--space-1);
  }
  .axes {
    display: flex;
    gap: var(--space-2);
  }
  .axes :global(.ci) {
    flex: 1;
    min-width: 0;
  }
</style>
