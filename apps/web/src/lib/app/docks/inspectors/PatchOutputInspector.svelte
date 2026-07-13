<script lang="ts">
  /* Patch output node — a physical controller port: its start-universe snap, channels/pixel,
     per-output RGB order (B5), and the physical port/line it drives (B2 expanded mode). Below the
     scalars sits the Pixel Output Table — the whole kit's per-output universe/channel map, the
     current port highlighted. Edits the routing scalars through setRouting. Offline-safe. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { ShellStore } from '../../shell-store.svelte';
  import type { KitConfig, RgbOrder } from '@ledrums/core';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import RenameField from './RenameField.svelte';
  import ReadRow from './ReadRow.svelte';
  import { onNum } from './forms';
  import { pixelsPerHoopForDrum, physicalPortLine, buildPixelOutputTable, type PatchEditor } from '../patch-inspector';
  import { fmtSpan, RGB_OPTS } from '../../views/node-options';
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
  const outputIndex = $derived(kit?.outputs.findIndex((o) => o.id === editor.outputId) ?? -1);
  const expanded = $derived(kit?.global.expanded ?? false);
  const liveRouting = $derived(shell.patchRouting);

  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
  const ranges = $derived(liveRouting ? pixelRanges(liveRouting, pixelsForHoop) : null);

  // Blank RGB order = inherit the controller wiring order (P3's deriveFlatOutputs fallback). Prepend
  // an explicit inherit sentinel so the Select can express "unset" instead of forcing a concrete order.
  const RGB_INHERIT = '';
  const rgbOptions = [{ value: RGB_INHERIT, label: 'Inherit (controller)' }, ...RGB_OPTS];

  // Whole-kit port map — one row per output, current port highlighted. Read the AUTHORITATIVE routing.
  const pixelTable = $derived(kit && liveRouting ? buildPixelOutputTable(liveRouting, kit, pixelsForHoop) : []);
  const port = $derived(outputIndex >= 0 ? physicalPortLine(outputIndex, expanded) : null);

  /** Rebuild the outputs array with one port's transport scalars changed → setRouting. A blank
      `startUniverse` (undefined) clears the snap → the port packs dense; a blank `rgbOrder` inherits. */
  function setOutputScalar(
    outputId: string,
    partial: { startUniverse?: number; channelsPerPixel?: number; rgbOrder?: RgbOrder },
  ): void {
    if (!kit) return;
    store.setRouting(kit.outputs.map((o) => (o.id === outputId ? { ...o, ...partial } : o)));
  }

  /** Device-facing universe/channel for the table: the API models both from 1 (PixLite Mk3 API v1.7
      `pixPort.startUni`/`startCh`); an unwired output (null universe / 0 px) reads em-dash. */
  const fmtUni = (u: number | null): string => (u === null ? '—' : `${u + 1}`);
  const fmtCh = (u: number | null, ch: number): string => (u === null ? '—' : `${(ch % 512) + 1}`);
</script>

{#if patchOutput}
  {@const cfg = patchOutput}
  <p class="grouphint">Set which universe this output starts on. Leave blank to auto-assign.</p>
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
  <Field layout="row" label="RGB order" hint="blank inherits controller">
    <Select
      value={cfg.rgbOrder ?? RGB_INHERIT}
      options={rgbOptions}
      disabled={!project}
      ariaLabel="RGB order"
      onChange={(v) => setOutputScalar(cfg.id, { rgbOrder: v === RGB_INHERIT ? undefined : (v as RgbOrder) })}
    />
  </Field>
  {#if port}
    <ReadRow label="Physical port" value={`Port ${port.port} · Line ${port.line}`} />
  {/if}
  <ReadRow label="First / last pixel" value={fmtSpan(ranges?.byOutput[cfg.id])} />
  {@const span = ranges?.byOutput[cfg.id]}
  <ReadRow label="Pixels on this run" value={span ? `${span.last - span.first + 1} px` : '—'} />

  {#if pixelTable.length}
    <div class="pxtable">
      <span class="tbl-head">Pixel output map</span>
      <div class="tbl-row tbl-colhead">
        <span class="c-idx">#</span>
        <span class="c-num">Uni</span>
        <span class="c-num">Ch</span>
        <span class="c-num">Px</span>
      </div>
      {#each pixelTable as row (row.outputId)}
        <div class="tbl-row" class:current={row.outputId === cfg.id}>
          <span class="c-idx">{row.index + 1}</span>
          <span class="c-num">{fmtUni(row.startUniverse)}</span>
          <span class="c-num">{fmtCh(row.startUniverse, row.startChannel)}</span>
          <span class="c-num">{row.pixelCount}</span>
        </div>
      {/each}
    </div>
  {/if}
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
  .pxtable {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: var(--space-2);
  }
  .tbl-head {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .tbl-row {
    display: grid;
    grid-template-columns: 2.5em 1fr 1fr 1fr;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .tbl-colhead {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .tbl-row.current {
    background: var(--surface-2);
    color: var(--text);
  }
  .c-idx {
    color: var(--text-faint);
  }
  .tbl-row.current .c-idx {
    color: var(--text);
  }
  .c-num {
    text-align: right;
  }
</style>
