<script lang="ts">
  /* Patch output node — a physical controller port: its start-universe snap, channels/pixel,
     and read-only pixel span. Edits the routing scalars through setRouting. Offline-safe. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../shell-store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { pixelsPerHoopForDrum, type PatchEditor } from '../patch-inspector';
  import { fmtSpan } from '../../views/node-options';
  import { pixelRanges, type HoopRef } from '../../patch-routing';

  let { store, shell, editor, nodeId, title }: {
    store: TriggerLab;
    shell: ShellStore;
    editor: Extract<PatchEditor, { kind: 'output' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const patchOutput = $derived(kit?.outputs.find((o) => o.id === editor.outputId) ?? null);
  const liveRouting = $derived(shell.patchRouting);

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
  const ranges = $derived(liveRouting ? pixelRanges(liveRouting, pixelsForHoop) : null);

  /** Rebuild the outputs array with one port's transport scalars changed → setRouting.
      A blank `startUniverse` (undefined) clears the snap → the port packs dense. */
  function setOutputScalar(outputId: string, partial: { startUniverse?: number; channelsPerPixel?: number }): void {
    if (!kit) return;
    store.setRouting(kit.outputs.map((o) => (o.id === outputId ? { ...o, ...partial } : o)));
  }
</script>

{#if patchOutput}
  {@const cfg = patchOutput}
  <p class="grouphint">A physical controller port. The controller owns universe offsets — leave blank to pack dense, or snap the port to a universe.</p>
  <Field layout="row" label="Start universe" hint="blank = dense / auto">
    <CommitInput
      type="number"
      min={0}
      value={cfg.startUniverse ?? ''}
      placeholder="dense"
      disabled={!project}
      ariaLabel="Start universe"
      onCommit={(v) =>
        v === '' ? setOutputScalar(cfg.id, { startUniverse: undefined }) : onNum(v, (n) => setOutputScalar(cfg.id, { startUniverse: n }))}
    />
  </Field>
  <Field layout="row" label="Channels / pixel" hint="3 = RGB · 4 = RGBW">
    <CommitInput
      type="number"
      min={1}
      max={4}
      value={cfg.channelsPerPixel}
      disabled={!project}
      ariaLabel="Channels per pixel"
      onCommit={(v) => onNum(v, (n) => setOutputScalar(cfg.id, { channelsPerPixel: n }))}
    />
  </Field>
  <ReadRow label="First / last pixel" value={fmtSpan(ranges?.byOutput[cfg.id])} />
{:else}
  <p class="hint">
    A new output port. Wire data lines into it on the canvas to give it pixels — then its universe + channel settings appear here.
  </p>
{/if}
<RenameField {store} {nodeId} fallback={title} />

<style>
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
