<script lang="ts">
  /* One physical output as a settings card (S4c): name (rename on `output:<id>`) + physical
     Port·Line badge, the transport scalars (start universe / channels-per-pixel / RGB order,
     the PatchOutputInspector form re-homed), and the ordered hoop CHAIN — pixel transmit
     order, edited by dragging (from this chain, another chain, or the pool), move up/down,
     remove (back to the pool), and an add picker fed only by the pool.

     Every chain edit leaves as a pure intent (`onDropHoop` / `onMove` / `onRemove` / `onAdd`);
     the pane owns the reduce → validate → setRouting commit, so the drag gesture rides the
     SAME mutation path as the buttons rather than opening a second one. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { RgbOrder } from '@ledrums/core';
  import type { HoopRef, PatchOutput, PixelSpan } from '../../patch-routing';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Select from '../../../ui/Select.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import ListHead from '../../../ui/ListHead.svelte';
  import TypeChip from '../../../ui/TypeChip.svelte';
  import ReadRow from '../../docks/inspectors/ReadRow.svelte';
  import RenameField from '../../docks/inspectors/RenameField.svelte';
  import { onNum, patchLabel } from '../../docks/inspectors/forms';
  import { physicalPortLine } from '../../docks/patch-inspector';
  import { outputNodeId } from '../../patch-graph';
  import { fmtSpan, RGB_OPTS } from '../../views/node-options';
  import { gapIndexAt } from '../../views/sections-dnd';
  import { hoopKey, type HoopDrag } from './chain-editor';
  import { isHoopDrag, readHoopDrag, writeHoopDrag } from './hoop-dnd';
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
    labels,
    span,
    disabled,
    canEdit,
    onScalar,
    onAdd,
    onRemove,
    onMove,
    onDropHoop,
  }: {
    store: TriggerLab;
    output: PatchOutput;
    index: number;
    expanded: boolean;
    pool: HoopRef[];
    /** A hoop's display names: `drum` rides the row's identity chip, `hoop` is the row
        title, `full` names it where there is no chip to carry the drum (picker, aria). */
    labels: (h: HoopRef) => { drum: string; hoop: string; full: string };
    span: PixelSpan | undefined;
    /** Offline (no project) — parks every control. */
    disabled: boolean;
    /** Viewer gating for the drag affordance (buttons ride the pane's fieldset). */
    canEdit: boolean;
    onScalar: (partial: { startUniverse?: number; channelsPerPixel?: number; rgbOrder?: RgbOrder }) => void;
    onAdd: (h: HoopRef) => void;
    onRemove: (index: number) => void;
    onMove: (from: number, to: number) => void;
    onDropHoop: (drag: HoopDrag, gap: number) => void;
  } = $props();

  const nodeId = $derived(outputNodeId(output.id));
  const fallback = $derived(`Output ${index + 1}`);
  const title = $derived(patchLabel(store, nodeId, fallback));
  const port = $derived(physicalPortLine(index, expanded));

  // Blank RGB order = inherit the controller wiring order — same sentinel as the old inspector.
  const RGB_INHERIT = '';
  const rgbOptions = [{ value: RGB_INHERIT, label: 'Inherit (controller)' }, ...RGB_OPTS];

  // ---- drag + drop ----
  // A drag can come from this chain (reorder), another chain (steal), or the pool (assign);
  // all three land on the same `onDropHoop`. `dragFrom` is only the local row's own dimming.
  let listEl = $state<HTMLDivElement | null>(null);
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);

  /** The gap index (0..hoops.length) the pointer sits at — pointer Y vs each row's midpoint. */
  function gapAt(clientY: number): number {
    const rows = listEl?.querySelectorAll<HTMLElement>('[data-chain-row]') ?? [];
    return gapIndexAt(Array.from(rows, (r) => r.getBoundingClientRect()), clientY);
  }
  /** Arm the drag — the setData/effectAllowed pair is required for Firefox to start it. */
  function onRowDragStart(i: number, hoop: HoopRef, event: DragEvent): void {
    dragFrom = i;
    writeHoopDrag(event.dataTransfer, { hoop, from: { outputId: output.id, index: i } });
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(event: DragEvent): void {
    // dataTransfer is unreadable during dragover (protected mode) — the type list is not.
    if (disabled || !canEdit || !isHoopDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropGap = gapAt(event.clientY);
  }
  function onDrop(event: DragEvent): void {
    const drag = readHoopDrag(event.dataTransfer);
    if (disabled || !canEdit || !drag) return;
    event.preventDefault();
    onDropHoop(drag, gapAt(event.clientY));
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
    <!-- Neutral by design: this page carries ONE accent family (drum identity on the chain
         rows). A second hue on every card header made it read as a fruit salad. -->
    <TypeChip label={`Port ${port.port} · Line ${port.line}`} />
  </header>

  <div class="set-grid">
    <Field label="Name">
      <RenameField {store} {nodeId} {fallback} bare />
    </Field>
    <Field label="Start universe" info="Leave blank for dense / automatic packing.">
      <CommitInput
        type="number"
        min={0}
        value={output.startUniverse ?? ''}
        placeholder="dense / auto"
        {disabled}
        ariaLabel={`${title} start universe`}
        onCommit={(v) => (v === '' ? onScalar({ startUniverse: undefined }) : onNum(v, (n) => onScalar({ startUniverse: n })))}
      />
    </Field>
    <Field label="Channels / pixel" info="3 = RGB · 4 = RGBW">
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
    <Field label="RGB order" info="Blank inherits the controller's wiring order.">
      <Select
        value={output.rgbOrder ?? RGB_INHERIT}
        options={rgbOptions}
        {disabled}
        ariaLabel={`${title} RGB order`}
        onChange={(v) => onScalar({ rgbOrder: v === RGB_INHERIT ? undefined : (v as RgbOrder) })}
      />
    </Field>
  </div>

  <ListHead label="Chain" count={output.hoops.length} />
  <div
    class="chain"
    class:targeted={dropGap !== null}
    role="list"
    aria-label={`${title} hoop chain`}
    bind:this={listEl}
    ondragover={onDragOver}
    ondragleave={() => (dropGap = null)}
    ondrop={onDrop}
  >
    {#if output.hoops.length === 0}
      <p class="empty">Drag a hoop here — this output transmits nothing yet.</p>
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
        aria-label={`Drag ${labels(hoop).full}`}
        ondragstart={(e) => onRowDragStart(i, hoop, e)}
        ondragend={endDrag}
      >
        {#if canEdit && !disabled}
          <span class="grip" aria-hidden="true"><GripVertical size={13} /></span>
        {/if}
        <span class="pos">{i + 1}</span>
        <TypeChip label={labels(hoop).drum} tint="var(--role-layer)" />
        <span class="hlabel">{labels(hoop).hoop}</span>
        <span class="rowops">
          <IconButton icon={ChevronUp} label="Move up" size={13} disabled={disabled || i === 0} onclick={() => onMove(i, i - 1)} />
          <IconButton icon={ChevronDown} label="Move down" size={13} disabled={disabled || i === output.hoops.length - 1} onclick={() => onMove(i, i + 1)} />
          <IconButton icon={X} label="Remove (back to pool)" size={13} {disabled} onclick={() => onRemove(i)} />
        </span>
      </div>
    {/each}
    {#if pool.length}
      <div class="addrow">
        <AddHoopPicker {pool} hoopLabel={(h) => labels(h).full} {disabled} {onAdd} />
      </div>
    {/if}
  </div>

  <div class="spans">
    <ReadRow label="First / last pixel" value={fmtSpan(span)} />
    <ReadRow label="Pixels on this run" value={span ? `${span.last - span.first + 1} px` : '—'} />
  </div>
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
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .cname {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spans {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .chain {
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
    border: 1px solid var(--border-faint);
    /* Concentric with the row radius: inner 3px + 3px padding ≈ 5px. */
    border-radius: var(--radius-2);
    background: var(--surface);
    transition-property: border-color, background-color;
    transition-duration: var(--dur-120);
  }
  /* A live drop target says so — the whole well lifts, not just the insertion line. */
  .chain.targeted {
    border-color: var(--accent-ring);
    background: var(--accent-soft);
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  /* Dense rows, hairline-separated — the divider is a whisper, the rhythm does the work. */
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    padding: 3px var(--space-1) 3px var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--text);
    transition-property: opacity, background-color;
    transition-duration: var(--dur-120);
  }
  .row + .row {
    box-shadow: inset 0 1px 0 color-mix(in oklch, var(--border-faint) 60%, transparent);
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
    top: -1px;
  }
  .row.drop-after::after {
    bottom: -1px;
  }
  .grip {
    display: inline-flex;
    color: var(--text-faint);
    cursor: grab;
  }
  .row:hover .grip {
    color: var(--text-muted);
  }
  .row:active .grip {
    cursor: grabbing;
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
    transition-property: opacity;
    transition-duration: var(--dur-120);
  }
  .row:hover .rowops,
  .rowops:focus-within {
    opacity: 1;
  }
  .addrow {
    padding: var(--space-1) var(--space-1) 0;
  }
</style>
