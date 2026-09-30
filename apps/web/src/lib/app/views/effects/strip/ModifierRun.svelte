<script lang="ts">
  /* The Modifier run of a chain — an Effect's, or the section Master's — with drag-to-reorder
     and the "+ Modifier" slot at its end. Each Modifier card sits behind a slim grip: drag the
     grip to move the card (an insertion line marks the gap; the drop is one undo step), or focus
     it and press ← / → to nudge. The drag only lands inside the run it started in — a Modifier
     belongs to its chain. */
  import type { effectChain } from '@ledrums/core';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import { tryGetModifier } from '@ledrums/core';
  import type { EffectsAuthoringApi, MASTER_CELL } from '../../../../trigger-lab/effects-api';
  import Tooltip from '../../../../ui/Tooltip.svelte';
  import ModifierCard from './cards/ModifierCard.svelte';
  import AddDeviceSlot from './AddDeviceSlot.svelte';
  import { gapAt, gapToIndex, nudgeIndex } from './strip-model';

  type Props = {
    api: EffectsAuthoringApi;
    owner: string | typeof MASTER_CELL;
    modifiers: readonly effectChain.ModifierDevice[];
  };

  let { api, owner, modifiers }: Props = $props();

  const DRAG_TYPE = 'application/x-ledrums-modifier';
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);
  let run: HTMLElement | undefined = $state();
  const disabled = $derived(!api.canEdit);

  function label(m: effectChain.ModifierDevice): string {
    return tryGetModifier(m.modifierId)?.name ?? m.modifierId;
  }

  function onDragStart(event: DragEvent, index: number): void {
    if (disabled || !event.dataTransfer) return;
    dragFrom = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, modifiers[index]!.uid);
    const card = (event.currentTarget as HTMLElement).closest('.mod-slot');
    if (card) event.dataTransfer.setDragImage(card, 12, 12);
  }

  function onDragOver(event: DragEvent, index: number): void {
    if (dragFrom === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropGap = gapAt(index, event.clientX, rect.left, rect.width);
  }

  function onDrop(event: DragEvent): void {
    if (dragFrom === null || dropGap === null) return;
    event.preventDefault();
    const to = gapToIndex(dragFrom, dropGap, modifiers.length);
    const uid = modifiers[dragFrom]!.uid;
    reset();
    if (to !== null) api.moveModifier(owner, uid, to);
  }

  function reset(): void {
    dragFrom = null;
    dropGap = null;
  }

  function onGripKey(event: KeyboardEvent, index: number): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const to = nudgeIndex(index, event.key === 'ArrowLeft' ? -1 : 1, modifiers.length);
    if (to === null) return;
    const uid = modifiers[index]!.uid;
    api.moveModifier(owner, uid, to);
    // Keep the grip under the keyboard: the keyed list moves the node, focus follows the uid.
    queueMicrotask(() => run?.querySelector<HTMLElement>(`[data-grip="${uid}"]`)?.focus());
  }
</script>

<div class="run" bind:this={run} role="list" aria-label="Modifiers">
  {#each modifiers as modifier, i (modifier.uid)}
    <div
      class="mod-slot"
      role="listitem"
      class:dragging={dragFrom === i}
      class:gap-before={dropGap === i && dragFrom !== null}
      class:gap-after={dropGap === i + 1 && i === modifiers.length - 1 && dragFrom !== null}
      ondragover={(e) => onDragOver(e, i)}
      ondrop={onDrop}
    >
      <Tooltip text="Drag to reorder · ← → to move" side="top">
        <button
          type="button"
          class="grip"
          draggable={!disabled && modifiers.length > 1}
          data-grip={modifier.uid}
          data-keyboard-owner="roving"
          aria-label={`${label(modifier)}, ${i + 1} of ${modifiers.length}. Arrow left or right to move.`}
          disabled={disabled || modifiers.length < 2}
          ondragstart={(e) => onDragStart(e, i)}
          ondragend={reset}
          onkeydown={(e) => onGripKey(e, i)}
        >
          <GripVertical size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      <ModifierCard {api} effectId={owner} {modifier} />
    </div>
  {/each}
  <AddDeviceSlot {api} kind="modifier" {owner} />
</div>

<style>
  .run {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    flex: none;
  }
  .mod-slot {
    position: relative;
    display: flex;
    align-items: stretch;
    flex: none;
  }
  .mod-slot.dragging {
    opacity: 0.45;
  }
  /* The insertion line sits in the gap BEFORE (or, for the last slot, after) the card. */
  .mod-slot.gap-before::before,
  .mod-slot.gap-after::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
  }
  .mod-slot.gap-before::before {
    left: calc(-1 * var(--space-1) - 1px);
  }
  .mod-slot.gap-after::after {
    right: calc(-1 * var(--space-1) - 1px);
  }
  .grip {
    display: grid;
    place-items: center;
    width: 14px;
    padding: 0;
    color: var(--text-disabled);
    background: var(--surface);
    border: 0;
    box-shadow: 0 0 0 1px var(--border-faint);
    cursor: grab;
  }
  .grip:hover:not(:disabled) {
    color: var(--ink);
    background: var(--surface-3);
  }
  .grip:disabled {
    cursor: default;
    color: transparent;
  }
  .grip:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
