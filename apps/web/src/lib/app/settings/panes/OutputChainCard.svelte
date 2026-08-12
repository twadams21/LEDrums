<script lang="ts">
  /* One physical output as a settings card (S4c): name (rename on `output:<id>`) + physical
     Port·Line badge, the transport scalars (start universe / channels-per-pixel / RGB order,
     the PatchOutputInspector form re-homed), and the ordered hoop CHAIN — pixel transmit
     order, edited by drag-reorder, move up/down, remove (back to the pool), and an add
     picker fed only by the pool. All chain edits flow up as pure intents (`onMove` /
     `onRemove` / `onAdd`); the pane owns the reduce → validate → setRouting commit. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { RgbOrder } from '@ledrums/core';
  import type { HoopRef, PatchOutput, PixelSpan } from '../../patch-routing';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import ReadRow from '../../docks/inspectors/ReadRow.svelte';
  import RenameField from '../../docks/inspectors/RenameField.svelte';
  import { onNum, patchLabel } from '../../docks/inspectors/forms';
  import { physicalPortLine } from '../../docks/patch-inspector';
  import { outputNodeId } from '../../patch-graph';
  import { fmtSpan, RGB_OPTS } from '../../views/node-options';
  import { gapIndexAt } from '../../views/sections-dnd';
  import { gapToIndex, hoopKey } from './chain-editor';
  import AddHoopPicker from './AddHoopPicker.svelte';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';

  let {
    store,
    output,
    index,
    expanded,
    pool,
    hoopLabel,
    span,
    disabled,
    canEdit,
    onScalar,
    onAdd,
    onRemove,
    onMove,
  }: {
    store: TriggerLab;
    output: PatchOutput;
    index: number;
    expanded: boolean;
    pool: HoopRef[];
    hoopLabel: (h: HoopRef) => string;
    span: PixelSpan | undefined;
    /** Offline (no project) — parks every control. */
    disabled: boolean;
    /** Viewer gating for the drag affordance (buttons ride the pane's fieldset). */
    canEdit: boolean;
    onScalar: (partial: { startUniverse?: number; channelsPerPixel?: number; rgbOrder?: RgbOrder }) => void;
    onAdd: (h: HoopRef) => void;
    onRemove: (index: number) => void;
    onMove: (from: number, to: number) => void;
  } = $props();

  const nodeId = $derived(outputNodeId(output.id));
  const fallback = $derived(`Output ${index + 1}`);
  const title = $derived(patchLabel(store, nodeId, fallback));
  const port = $derived(physicalPortLine(index, expanded));

  // Blank RGB order = inherit the controller wiring order — same sentinel as the old inspector.
  const RGB_INHERIT = '';
  const rgbOptions = [{ value: RGB_INHERIT, label: 'Inherit (controller)' }, ...RGB_OPTS];

  // ---- drag-reorder (within this chain only; cross-output moves go via the pool) ----
  let listEl = $state<HTMLDivElement | null>(null);
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);

  /** The gap index (0..hoops.length) the pointer sits at — pointer Y vs each row's midpoint. */
  function gapAt(clientY: number): number {
    const rows = listEl?.querySelectorAll<HTMLElement>('[data-chain-row]') ?? [];
    return gapIndexAt(Array.from(rows, (r) => r.getBoundingClientRect()), clientY);
  }
  /** Arm the drag — the setData/effectAllowed pair is required for Firefox to start it. */
  function onRowDragStart(i: number, event: DragEvent): void {
    dragFrom = i;
    event.dataTransfer?.setData('application/x-ledrums-hoop', String(i));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(event: DragEvent): void {
    if (dragFrom === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropGap = gapAt(event.clientY);
  }
  function onDrop(event: DragEvent): void {
    if (dragFrom === null) return;
    event.preventDefault();
    const to = gapToIndex(dragFrom, gapAt(event.clientY));
    if (to !== dragFrom) onMove(dragFrom, to);
    endDrag();
  }
  function endDrag(): void {
    dragFrom = null;
    dropGap = null;
  }
</script>

<section class="card" aria-label={title}>
  <header class="chead">
    <span class="cname">{title}</span>
    <span class="portbadge">Port {port.port} · Line {port.line}</span>
  </header>

  <RenameField {store} {nodeId} {fallback} />
  <Field layout="row" label="Start universe" hint="blank = dense / auto">
    <CommitInput
      type="number"
      min={0}
      value={output.startUniverse ?? ''}
      placeholder="dense"
      {disabled}
      ariaLabel={`${title} start universe`}
      onCommit={(v) => (v === '' ? onScalar({ startUniverse: undefined }) : onNum(v, (n) => onScalar({ startUniverse: n })))}
    />
  </Field>
  <Field layout="row" label="Channels / pixel" hint="3 = RGB · 4 = RGBW">
    <CommitInput
      type="number"
      min={1}
      max={4}
      value={output.channelsPerPixel}
      {disabled}
      ariaLabel={`${title} channels per pixel`}
      onCommit={(v) => onNum(v, (n) => onScalar({ channelsPerPixel: n }))}
    />
  </Field>
  <Field layout="row" label="RGB order" hint="blank inherits controller">
    <Select
      value={output.rgbOrder ?? RGB_INHERIT}
      options={rgbOptions}
      {disabled}
      ariaLabel={`${title} RGB order`}
      onChange={(v) => onScalar({ rgbOrder: v === RGB_INHERIT ? undefined : (v as RgbOrder) })}
    />
  </Field>

  <div class="chain" role="list" aria-label={`${title} hoop chain`} bind:this={listEl} ondragover={onDragOver} ondrop={onDrop}>
    {#if output.hoops.length === 0}
      <p class="empty">No hoops on this chain — the output transmits nothing.</p>
    {/if}
    {#each output.hoops as hoop, i (hoopKey(hoop))}
      <div
        class="row"
        class:dragging={dragFrom === i}
        class:drop-before={dropGap === i}
        class:drop-after={dropGap === output.hoops.length && i === output.hoops.length - 1}
        role="listitem"
        data-chain-row
        draggable={canEdit && !disabled}
        aria-label={`Drag ${hoopLabel(hoop)}`}
        ondragstart={(e) => onRowDragStart(i, e)}
        ondragend={endDrag}
      >
        {#if canEdit && !disabled}
          <span class="grip" aria-hidden="true"><GripVertical size={13} /></span>
        {/if}
        <span class="pos">{i + 1}</span>
        <span class="hlabel">{hoopLabel(hoop)}</span>
        <span class="rowops">
          <IconButton icon={ChevronUp} label="Move up" size={13} disabled={disabled || i === 0} onclick={() => onMove(i, i - 1)} />
          <IconButton icon={ChevronDown} label="Move down" size={13} disabled={disabled || i === output.hoops.length - 1} onclick={() => onMove(i, i + 1)} />
          <IconButton icon={X} label="Remove (back to pool)" size={13} {disabled} onclick={() => onRemove(i)} />
        </span>
      </div>
    {/each}
    {#if pool.length}
      <div class="addrow">
        <AddHoopPicker {pool} {hoopLabel} {disabled} {onAdd} />
      </div>
    {/if}
  </div>

  <ReadRow label="First / last pixel" value={fmtSpan(span)} />
  <ReadRow label="Pixels on this run" value={span ? `${span.last - span.first + 1} px` : '—'} />
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    background: var(--surface-2);
  }
  .chead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .cname {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .portbadge {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .chain {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1);
    border: 1px solid var(--border-faint);
    /* Concentric with the row radius: inner 3px + 3px padding ≈ 5px. */
    border-radius: var(--radius-2);
    background: var(--surface);
  }
  .empty {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px var(--space-1) 2px var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--text);
    transition: opacity var(--dur-120) ease;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.dragging {
    opacity: 0.4;
  }
  /* Drag insertion line — absolutely positioned so nothing shifts while targeting. */
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .row.drop-before::before {
    top: -2px;
  }
  .row.drop-after::after {
    bottom: -2px;
  }
  .grip {
    display: inline-flex;
    color: var(--text-faint);
    cursor: grab;
  }
  .row:hover .grip {
    color: var(--text-muted);
  }
  .pos {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
    min-width: 1.2em;
    text-align: right;
  }
  .hlabel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rowops {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    opacity: 0;
    transition: opacity var(--dur-120) ease;
  }
  .row:hover .rowops,
  .rowops:focus-within {
    opacity: 1;
  }
  .addrow {
    padding: var(--space-1);
  }
</style>
