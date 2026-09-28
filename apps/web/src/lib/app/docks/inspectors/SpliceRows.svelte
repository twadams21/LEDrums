<script lang="ts">
  /* The content rows, shared by the Splice and Slice inspectors: one row per splice or slice — a
     colour, an effect, or both (the colour then tints the effect), or neither (it stays blank).
     Lifted verbatim from the Splice inspector; only the noun is a prop.

     Rows reorder by their grip (Tim, 2026-09-28: re-ordering a set of colours used to mean
     dialling every colour again): drag it to a new place, or focus it and press ↑ / ↓. A row
     moves whole — colour, effect and mute — through one store action, one undo step. The drop
     gap comes from the pointer against every row's midpoint (the Sections list's rule), so the
     spaces BETWEEN rows are valid drop targets too. */
  import { tick } from 'svelte';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import ColorField from '../../../ui/ColorField.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import { gapIndexAt } from '../../views/sections-dnd';
  import { SPLICE_NO_EFFECT, describeSpliceRow, spliceEffectOptions, spliceRows } from '../../views/splice-options';

  let { store, node, noun = 'Splice' }: { store: TriggerLab; node: GraphNode; noun?: 'Splice' | 'Slice' } = $props();

  const rows = $derived(spliceRows(node));
  const effectOpts = $derived(spliceEffectOptions(store.effects));
  const tint = $derived(node.spliceTint ?? 1);
  const anyTinted = $derived(rows.some((r) => r.color && r.effectId && !r.muted));
  const effectName = (id: string) => store.effects.find((e) => e.id === id)?.name ?? id;
  /** Private drag type: a splice row can't be dropped anywhere else, nor anything dropped here. */
  const DRAG_TYPE = 'application/x-ledrums-splice';
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);
  let list: HTMLUListElement | undefined = $state();

  function gapAt(clientY: number): number {
    const items = list?.querySelectorAll<HTMLElement>(':scope > li') ?? [];
    return gapIndexAt(Array.from(items, (item) => item.getBoundingClientRect()), clientY);
  }
  function endDrag(): void {
    dragFrom = null;
    dropGap = null;
  }
  /** Move a row, then (keyboard) keep focus on its grip at the row's NEW place so ↑ / ↓ can be
      pressed again without hunting for it — rows are keyed by position, so the old grip now
      belongs to a different row. */
  async function move(from: number, gap: number, refocus: boolean): Promise<void> {
    store.moveSplice(node, from, gap);
    if (!refocus) return;
    await tick();
    const landed = gap > from ? gap - 1 : gap;
    list?.querySelector<HTMLButtonElement>(`button[data-grip="${landed}"]`)?.focus();
  }
  function onGripKey(event: KeyboardEvent, index: number): void {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      void move(index, index - 1, true);
    } else if (event.key === 'ArrowDown' && index < rows.length - 1) {
      event.preventDefault();
      void move(index, index + 2, true);
    }
  }

  const TINT_INFO = $derived(`How strongly a ${noun.toLowerCase()}'s colour recolours the effect inside it. A ${noun.toLowerCase()} with no colour is never tinted.`);
</script>

<section class="group">
  <div class="grouphead">
    <h4 class="grouptitle">{noun}s</h4>
    <IconButton
      icon={Plus}
      label="Add {noun.toLowerCase()}"
      variant="soft"
      size={14}
      onclick={() => store.addSplice(node)}
    />
  </div>

  <ul
    class="rows"
    bind:this={list}
    aria-label="{noun}s, in order"
    ondragover={(e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      dropGap = gapAt(e.clientY);
    }}
    ondrop={(e) => {
      e.preventDefault();
      if (dragFrom !== null) void move(dragFrom, gapAt(e.clientY), false);
      endDrag();
    }}
    ondragleave={(e) => {
      if (!(e.relatedTarget instanceof Node && list?.contains(e.relatedTarget))) dropGap = null;
    }}
  >
    {#each rows as row (row.index)}
      <li
        class="row"
        class:blank={row.blank}
        class:dragging={dragFrom === row.index}
        class:drop-before={dragFrom !== null && dropGap === row.index}
        class:drop-after={dragFrom !== null && dropGap === rows.length && row.index === rows.length - 1}
      >
        <div class="rowhead">
          {#if rows.length > 1}
            <button
              type="button"
              class="grip"
              data-grip={row.index}
              draggable="true"
              aria-label="Move {noun.toLowerCase()} {row.index + 1} — drag, or press up and down"
              title="Drag to reorder (or ↑ / ↓)"
              onkeydown={(e) => onGripKey(e, row.index)}
              ondragstart={(e) => {
                dragFrom = row.index;
                if (!e.dataTransfer) return;
                e.dataTransfer.setData(DRAG_TYPE, String(row.index));
                e.dataTransfer.effectAllowed = 'move';
                // Carry the whole row, not the little grip, so it reads as "this row moves".
                const item = (e.currentTarget as HTMLElement).closest('li');
                if (item) e.dataTransfer.setDragImage(item, 16, 16);
              }}
              ondragend={endDrag}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
          {/if}
          <span class="idx">{row.index + 1}</span>
          <span class="rowdesc">{describeSpliceRow(row, effectName)}</span>
          <span class="rowactions">
            <Toggle
              pressed={!row.muted}
              onChange={(on) => store.setSpliceAt(node, row.index, { muted: !on })}
              ariaLabel="{noun} {row.index + 1} on"
            />
            <IconButton
              icon={Trash2}
              label="Remove {noun.toLowerCase()} {row.index + 1}"
              variant="soft"
              size={13}
              disabled={rows.length <= 1}
              onclick={() => store.removeSplice(node, row.index)}
            />
          </span>
        </div>

        <div class="rowbody">
          <ColorField
            value={row.color}
            onChange={(v) => store.setSpliceAt(node, row.index, { color: v })}
            ariaLabel="{noun} {row.index + 1} colour"
          />
          <!-- Effect names come from the show, so a three-effect show must not turn this
               into three segments of ellipsised text — stay a dropdown at every length. -->
          <Select
            value={row.effectId ?? SPLICE_NO_EFFECT}
            options={effectOpts}
            segment={false}
            onChange={(v) => store.setSpliceAt(node, row.index, { effectId: v === SPLICE_NO_EFFECT ? undefined : v })}
            ariaLabel="{noun} {row.index + 1} effect"
          />
        </div>
      </li>
    {/each}
  </ul>

  {#if anyTinted}
    <Field layout="row" label="Tint" info={TINT_INFO}>
      <Slider
        value={tint}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => store.setSpliceSetting(node, { spliceTint: v })}
        format={(v) => `${Math.round(v * 100)}%`}
        ariaLabel="{noun} tint amount"
      />
    </Field>
  {:else if rows.every((r) => r.blank)}
    <!-- The one explanation that earns its space: the empty state, where nothing on screen
         says yet what a splice row is for. -->
    <p class="hint">Give a {noun.toLowerCase()} a colour, an effect, or both — with both, the colour tints the effect.</p>
  {/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .grouphead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .grouptitle {
    margin: 0;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-2);
    background: var(--surface-raised);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  /* A blank splice renders nothing on the kit — say so quietly rather than hiding the row. */
  .row.blank .rowdesc {
    opacity: 0.6;
    font-style: italic;
  }
  /* The row being carried fades, so the accent bar reads as where it will land. */
  .row.dragging {
    opacity: 0.4;
  }
  /* Landing marker: an accent bar in the gap above (or, for the end, below) the target row. */
  .row.drop-before::before,
  .row.drop-after::after {
    content: '';
    position: absolute;
    left: var(--space-1);
    right: var(--space-1);
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .row.drop-before::before {
    top: calc(-1 * var(--space-1) - 1px);
  }
  .row.drop-after::after {
    bottom: calc(-1 * var(--space-1) - 1px);
  }
  .grip {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 24px;
    margin-left: calc(-1 * var(--space-1));
    padding: 0;
    color: var(--text-faint);
    background: transparent;
    border: none;
    border-radius: var(--radius-1);
    cursor: grab;
    transition-property: color, background-color;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .grip:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .grip:active {
    cursor: grabbing;
  }
  .grip:focus-visible {
    outline: none;
    color: var(--text);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .rowhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .idx {
    flex: none;
    min-width: 1.4em;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .rowdesc {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rowactions {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  /* One control per line: at the inspector's real width a colour well + a full effect
     name side by side truncates both (the hex reads "#F…" and the effect name wraps). */
  .rowbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>
