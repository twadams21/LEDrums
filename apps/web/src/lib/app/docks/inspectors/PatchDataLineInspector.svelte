<script lang="ts">
  /* Patch data-line node — its transmit order, owning output, pixel span, and the optional
     start-universe snap (blank = dense / auto-pack). Edits the LIVE routing and recompiles
     through setRouting. No-op-safe while offline. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../shell-store.svelte';
  import type { KitConfig } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum, patchLabel } from './forms';
  import { orderedDataLines, pixelsPerHoopForDrum, type PatchEditor } from '../patch-inspector';
  import { fmtSpan, uLabel } from '../../views/node-options';
  import { patchToOutputs, pixelRanges, type HoopRef, type PatchRouting } from '../../patch-routing';

  let { store, shell, nodeId, title }: {
    store: TriggerLab;
    shell: ShellStore;
    editor: Extract<PatchEditor, { kind: 'dataline' }>;
    nodeId: string;
    title: string;
  } = $props();

  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const liveRouting = $derived(shell.patchRouting);

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
  const ranges = $derived(liveRouting ? pixelRanges(liveRouting, pixelsForHoop) : null);
  const orderedLines = $derived(liveRouting ? orderedDataLines(liveRouting) : []);
  const entry = $derived(orderedLines.find((o) => o.line.id === nodeId));

  /** Set (or clear, when undefined) a data line's optional startUniverse snap, keyed by its
      graph node id — edits the LIVE routing and recompiles → setRouting. Blank = dense. */
  function setDataLineUniverse(lineNodeId: string, startUniverse: number | undefined): void {
    if (!liveRouting) return;
    const updated: PatchRouting = {
      outputs: liveRouting.outputs.map((o) => ({
        ...o,
        dataLines: o.dataLines.map((dl) => (dl.id === lineNodeId ? { ...dl, startUniverse } : dl)),
      })),
    };
    store.setRouting(patchToOutputs(updated));
  }
</script>

{#if entry}
  <ReadRow label="Order" value={`#${entry.pos} in transmit order`} />
  <ReadRow label="Output" value={`${patchLabel(store, `output:${entry.output.id}`, 'Output')} · ${uLabel(entry.output.startUniverse)}`} />
  <ReadRow label="First / last pixel" value={fmtSpan(ranges?.byDataLine[entry.line.id])} />
  <Field layout="row" label="Start universe" hint="blank = dense / auto">
    <CommitInput
      type="number"
      min={0}
      value={entry.line.startUniverse ?? ''}
      placeholder="dense"
      disabled={!project}
      ariaLabel="Data line start universe"
      onCommit={(v) =>
        v === '' ? setDataLineUniverse(nodeId, undefined) : onNum(v, (n) => setDataLineUniverse(nodeId, n))}
    />
  </Field>
  <p class="hint">
    {entry.line.hoops.length} hoops. Re-order or re-wire on the Patch canvas — pixel order is what transmits; a start universe snaps this line to a hard boundary.
  </p>
{:else}
  <p class="hint">
    A data line carries an ordered run of hoops to one output. Wire hoops into it on the canvas; its pixel span appears once the routing is saved.
  </p>
{/if}
<RenameField {store} {nodeId} fallback={title} />

<style>
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
