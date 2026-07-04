<script lang="ts">
  /* Patch drum node — the drum's geometry (origin / rotation / angles / pixels / spacing /
     diameter), written through the authoritative store mutators. No-op-safe while offline. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import RenameField from './RenameField.svelte';
  import { onNum } from './forms';
  import { pixelsPerHoopForDrum, type PatchEditor } from '../patch-inspector';
  import type { HoopRef } from '../../patch-routing';

  let { store, editor, nodeId, title }: {
    store: TriggerLab;
    editor: Extract<PatchEditor, { kind: 'drum' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const drum = $derived(kit?.drums.find((x) => x.id === editor.drumId) ?? null);

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
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
  <Field layout="row" label="Pixels per hoop" hint="literal LED count">
    <CommitInput
      type="number"
      min={1}
      value={pixelsForHoop({ drumId: drum.id, hoop: 0 })}
      disabled={!project}
      suffix="px"
      ariaLabel="Pixels per hoop"
      onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { pixelsPerHoop: n }))}
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
