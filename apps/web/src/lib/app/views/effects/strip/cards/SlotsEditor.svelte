<script lang="ts">
  /* The Splice / Slice slots, on the Generator card: one row per slot — a colour, a nested
     Generator, or both (the colour then tints the Generator), or neither (blank). Reshaped from
     the graph Splice inspector's rows (`docks/inspectors/SpliceRows.svelte`) onto the authoring
     api: every edit writes the whole slot list through `setSpliceSlots`, one undo step each.

     Slots reorder by their grip (Tim, 2026-09-28: re-ordering a set of colours meant dialling each
     one again): drag it to a new place, or focus it and press ↑ / ↓. A slot moves whole — colour,
     Generator, on/off — as one list write, one undo step. Same grip, insertion line and
     `strip-model` gap maths as the Modifier run, turned vertical; the drag only lands in the list
     it started in. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import IconButton from '../../../../../ui/IconButton.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Power from '@lucide/svelte/icons/power';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import { tick } from 'svelte';
  import { gapAt, gapToIndex, nudgeIndex } from '../strip-model';
  import GestureScope from './GestureScope.svelte';
  import {
    SLOT_NO_GENERATOR,
    currentStyle,
    describeSlot,
    isBlankSlot,
    slotGeneratorOptions,
    styleOptions,
    type SpliceSlot,
  } from './card-model';

  interface Props {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
  }

  let { api, effect }: Props = $props();

  const noun = $derived(effect.generator.kind === 'slice' ? 'Slice' : 'Splice');
  const slots = $derived(effect.generator.slots ?? []);
  const genOptions = slotGeneratorOptions();
  const disabled = $derived(!api.canEdit);

  /** A new slot gets the next colour of a spread palette, so it is visibly its own band. */
  const NEW_SLOT_COLOURS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2', '#ffffff'];

  function write(next: SpliceSlot[]): void {
    api.setSpliceSlots(effect.id, next);
  }
  function patch(index: number, change: Partial<SpliceSlot>): void {
    write(
      slots.map((s, i) => {
        if (i !== index) return s;
        const merged: SpliceSlot = { ...s, ...change };
        // Absent, not undefined, keeps the stored slot clean (and file round-trips exact).
        for (const k of Object.keys(merged) as (keyof SpliceSlot)[]) if (merged[k] === undefined) delete merged[k];
        return merged;
      }),
    );
  }
  function add(): void {
    write([...slots, { color: NEW_SLOT_COLOURS[slots.length % NEW_SLOT_COLOURS.length]! }]);
  }
  function remove(index: number): void {
    write(slots.filter((_, i) => i !== index));
  }
  function setGenerator(index: number, kind: string): void {
    patch(index, { generator: kind === SLOT_NO_GENERATOR ? undefined : { kind: kind as effectChain.GeneratorKind, style: '', params: {} } });
  }
  function setStyle(index: number, style: string): void {
    const g = slots[index]?.generator;
    if (g) patch(index, { generator: { ...g, style, params: {} } });
  }

  /** Move slot `from` to final index `to` — the whole list in one write, one undo step. */
  function move(from: number, to: number): void {
    const next = [...slots];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    write(next);
  }

  const DRAG_TYPE = 'application/x-ledrums-splice-slot';
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);
  let list: HTMLOListElement | undefined = $state();

  function onDragStart(event: DragEvent, index: number): void {
    if (disabled) return;
    dragFrom = index;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, String(index));
    // Carry the whole slot, not the little grip, so it reads as "this slot moves".
    const item = (event.currentTarget as HTMLElement).closest('.slot');
    if (item) event.dataTransfer.setDragImage(item, 12, 12);
  }
  function onDragOver(event: DragEvent, index: number): void {
    if (dragFrom === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropGap = gapAt(index, event.clientY, rect.top, rect.height);
  }
  function onDrop(event: DragEvent): void {
    if (dragFrom === null || dropGap === null) return;
    event.preventDefault();
    const from = dragFrom;
    const to = gapToIndex(from, dropGap, slots.length);
    resetDrag();
    if (to !== null) move(from, to);
  }
  function resetDrag(): void {
    dragFrom = null;
    dropGap = null;
  }
  /** ↑ / ↓ on a grip. Slots are keyed by position, so focus is moved to the grip at the slot's
      NEW index once the list has re-rendered — ↑ / ↓ can then be pressed again. */
  async function onGripKey(event: KeyboardEvent, index: number): Promise<void> {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = nudgeIndex(index, event.key === 'ArrowUp' ? -1 : 1, slots.length);
    if (to === null) return;
    move(index, to);
    await tick();
    list?.querySelector<HTMLElement>(`[data-grip="${to}"]`)?.focus();
  }

  const allBlank = $derived(slots.every(isBlankSlot));
</script>

<section class="slots" aria-label={`${noun}s`}>
  <div class="head">
    <span class="headlabel">{noun}s</span>
    <span class="count">{slots.length}</span>
    <IconButton icon={Plus} label={`Add ${noun.toLowerCase()}`} size={14} {disabled} onclick={add} />
  </div>

  {#if slots.length === 0 || allBlank}
    <p class="hint">Give a {noun.toLowerCase()} a colour, a generator, or both. With both, the colour tints the generator.</p>
  {/if}

  <ol class="list" bind:this={list}>
    {#each slots as slot, i (i)}
      {@const styles = slot.generator ? styleOptions(slot.generator.kind) : []}
      <li
        class="slot"
        class:off={slot.muted}
        class:dragging={dragFrom === i}
        class:gap-before={dropGap === i && dragFrom !== null}
        class:gap-after={dropGap === i + 1 && i === slots.length - 1 && dragFrom !== null}
        ondragover={(e) => onDragOver(e, i)}
        ondrop={onDrop}
      >
        <div class="slothead">
          {#if slots.length > 1}
            <Tooltip text="Drag to reorder · ↑ ↓ to move" side="top">
              <button
                type="button"
                class="grip"
                draggable={!disabled}
                data-grip={i}
                data-keyboard-owner="roving"
                aria-label={`${noun} ${i + 1} of ${slots.length}. Arrow up or down to move.`}
                {disabled}
                ondragstart={(e) => onDragStart(e, i)}
                ondragend={resetDrag}
                onkeydown={(e) => void onGripKey(e, i)}
              >
                <GripVertical size={12} aria-hidden="true" />
              </button>
            </Tooltip>
          {/if}
          <span class="idx">{i + 1}</span>
          <span class="desc" title={describeSlot(slot)}>{describeSlot(slot)}</span>
          <Tooltip text={slot.muted ? `Turn ${noun.toLowerCase()} ${i + 1} on` : `Turn ${noun.toLowerCase()} ${i + 1} off`}>
            <button
              type="button"
              class="pwr"
              class:on={!slot.muted}
              aria-pressed={!slot.muted}
              aria-label={`${noun} ${i + 1} on`}
              {disabled}
              onclick={() => patch(i, { muted: slot.muted ? undefined : true })}
            >
              <Power size={12} aria-hidden="true" />
            </button>
          </Tooltip>
          <IconButton
            icon={Trash2}
            label={`Remove ${noun.toLowerCase()} ${i + 1}`}
            size={13}
            disabled={disabled || slots.length <= 1}
            onclick={() => remove(i)}
          />
        </div>
        <GestureScope onGestureStart={() => api.beginGesture()} onGestureEnd={() => api.endGesture()}>
          <ColorField
            value={slot.color ?? null}
            {disabled}
            ariaLabel={`${noun} ${i + 1} colour`}
            onChange={(v) => patch(i, { color: v ?? undefined })}
          />
        </GestureScope>
        <div class="gen">
          <Select
            value={slot.generator?.kind ?? SLOT_NO_GENERATOR}
            options={genOptions}
            segment={false}
            {disabled}
            ariaLabel={`${noun} ${i + 1} generator`}
            onChange={(v) => setGenerator(i, v)}
          />
          {#if slot.generator && styles.length > 1}
            <Select
              value={currentStyle(slot.generator)}
              options={styles}
              segment={false}
              {disabled}
              ariaLabel={`${noun} ${i + 1} style`}
              onChange={(v) => setStyle(i, v)}
            />
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</section>

<style>
  .slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
  }
  .headlabel {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .count {
    flex: 1 1 auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-snug);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .slot {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    padding: var(--space-1_5);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  /* The slot being carried fades, so the insertion line reads as where it will land. */
  .slot.dragging {
    opacity: 0.45;
  }
  /* The insertion line sits in the gap ABOVE (or, for the last slot, below) the slot. */
  .slot.gap-before::before,
  .slot.gap-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .slot.gap-before::before {
    top: calc(-1 * var(--space-1) - 1px);
  }
  .slot.gap-after::after {
    bottom: calc(-1 * var(--space-1) - 1px);
  }
  .grip {
    display: grid;
    place-items: center;
    width: 16px;
    height: 20px;
    padding: 0;
    color: var(--text-disabled);
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: grab;
  }
  .grip:hover:not(:disabled) {
    color: var(--ink);
    background: var(--surface-3);
  }
  .grip:active:not(:disabled) {
    cursor: grabbing;
  }
  .grip:disabled {
    cursor: default;
  }
  .grip:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .slot.off .desc {
    color: var(--text-disabled);
  }
  .slothead {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .idx {
    flex: none;
    min-width: 1.4em;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .desc {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .pwr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    line-height: 0;
  }
  .pwr:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .pwr.on {
    color: var(--role-content);
  }
  .pwr:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .pwr:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .gen {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
