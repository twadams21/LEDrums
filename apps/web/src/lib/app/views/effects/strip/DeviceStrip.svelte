<script lang="ts">
  /* The device strip (effect chains, S06b) — Ableton's Device View for the selected grid cell.

     - A cell: its Effect stack, one chain row per Effect in stack order (a header + a
       horizontally scrolling chain). Drag a header's grip to reorder the stack (or ↑ / ↓ on the
       grip); the drop is one `moveEffect`, one undo step. "Add Effect" picks a Generator.
     - The Master cell: the section's master modifier chain, modifiers only.
     - Nothing selected / a disabled cell: a short explanation instead of an empty panel.

     Reads and edits go only through `EffectsAuthoringApi`; the strip holds no document state. */
  import { DropdownMenu } from 'bits-ui';
  import { effectChain } from '@ledrums/core';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { MASTER_CELL, type CellSelection, type EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import EffectHeader from './EffectHeader.svelte';
  import EffectChain from './EffectChain.svelte';
  import ModifierRun from './ModifierRun.svelte';
  import CellPlayBar from './CellPlayBar.svelte';
  import { GENERATOR_ICON } from './generator-icons';
  import { gapAt, gapToIndex, nudgeIndex } from './strip-model';

  type EffectCell = effectChain.EffectCell;

  let { api, cell }: { api: EffectsAuthoringApi; cell: CellSelection | null } = $props();

  const generators = effectChain.listGenerators();
  const zoneCell = $derived(cell !== null && cell !== MASTER_CELL ? cell : null);
  const summary = $derived(zoneCell ? api.cellSummary(zoneCell) : null);
  const effects = $derived(zoneCell ? api.cellEffects(zoneCell) : []);
  const title = $derived.by(() => {
    if (!zoneCell) return '';
    const row = api.gridRows.find((r) => r.id === zoneCell.row)?.label ?? zoneCell.row;
    return `${row} · ${summary?.label ?? ''}`;
  });
  const canAdd = $derived(api.canEdit && (summary?.enabled ?? false));
  // Sequence / Random: the un-bypassed rows are the steps, numbered in stack order.
  const playMode = $derived(zoneCell ? (api.cellPlay(zoneCell)?.mode ?? 'layer') : 'layer');
  const stepOf = $derived.by(() => {
    const steps = new Map<string, number>();
    effects.filter((e) => !e.bypass).forEach((e, i) => steps.set(e.id, i));
    return steps;
  });
  const lastStep = $derived(zoneCell && playMode !== 'layer' ? api.lastPlayedStep(zoneCell) : null);

  function addEffect(kind: effectChain.GeneratorKind): void {
    if (zoneCell) api.addEffect(zoneCell, kind);
  }

  // ---- stack reorder (vertical) --------------------------------------------------------
  const DRAG_TYPE = 'application/x-ledrums-effect';
  let dragFrom = $state<number | null>(null);
  let dropGap = $state<number | null>(null);
  let stackEl: HTMLElement | undefined = $state();

  function move(from: number, to: number | null): void {
    if (to === null || !zoneCell) return;
    api.moveEffect(effects[from]!.id, zoneCell as EffectCell, to);
  }

  function onGripDragStart(event: DragEvent, index: number): void {
    dragFrom = index;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, effects[index]!.id);
    const row = (event.currentTarget as HTMLElement).closest('.effect-row');
    if (row) event.dataTransfer.setDragImage(row, 16, 16);
  }

  function onRowDragOver(event: DragEvent, index: number): void {
    if (dragFrom === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropGap = gapAt(index, event.clientY, rect.top, rect.height);
  }

  function onRowDrop(event: DragEvent): void {
    if (dragFrom === null || dropGap === null) return;
    event.preventDefault();
    const from = dragFrom;
    const to = gapToIndex(from, dropGap, effects.length);
    reset();
    move(from, to);
  }

  function reset(): void {
    dragFrom = null;
    dropGap = null;
  }

  /** The Effect itself is highlighted (its name bar was clicked) — not just a card inside it. */
  const boxed = (effectId: string): boolean => {
    const held = api.selectedDevice;
    return held?.kind === 'effect' && held.effectId === effectId;
  };

  function nudge(index: number, delta: -1 | 1): void {
    const id = effects[index]!.id;
    move(index, nudgeIndex(index, delta, effects.length));
    queueMicrotask(() => stackEl?.querySelector<HTMLElement>(`[data-effect="${id}"] .grip`)?.focus());
  }
</script>

<section class="strip" aria-label="Device strip">
  {#if cell === null}
    <p class="empty">Select a cell in the grid to see its Effects.</p>
  {:else if cell === MASTER_CELL}
    <header class="bar">
      <SlidersHorizontal size={14} class="bar-icon" aria-hidden="true" />
      <h2>Master</h2>
      <span class="meta">Applied to everything this section renders</span>
    </header>
    <div class="master">
      <ModifierRun {api} owner={MASTER_CELL} modifiers={api.masterChain} />
    </div>
  {:else if summary && !summary.enabled}
    <p class="empty">This cell can’t hold Effects — the drum has no zone here.</p>
  {:else}
    <header class="bar">
      <h2>{title}</h2>
      <span class="meta count">{effects.length} {effects.length === 1 ? 'Effect' : 'Effects'}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="add-effect" disabled={!canAdd}>
          <Plus size={14} aria-hidden="true" />
          Add Effect
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="lab-ctx-content" data-keyboard-owner="menu" sideOffset={4} align="end">
            {#each generators as gen (gen.id)}
              {@const Icon = GENERATOR_ICON[gen.id]}
              <DropdownMenu.Item class="lab-ctx-item" data-keyboard-owner="menuitem" onSelect={() => addEffect(gen.id)}>
                <Icon size={14} aria-hidden="true" />
                <span class="lab-ctx-label">{gen.label}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>

    {#if zoneCell && zoneCell.column.kind !== 'always' && effects.length > 0}
      <CellPlayBar {api} cell={zoneCell} steps={stepOf.size} />
    {/if}

    {#if effects.length === 0}
      <p class="empty">No Effects in this cell yet. Add one to start from a Generator.</p>
    {:else}
      <div class="stack" bind:this={stackEl} role="list" aria-label="Effect stack">
        {#each effects as effect, i (effect.id)}
          <div
            class="effect-row"
            role="listitem"
            data-effect={effect.id}
            class:boxed={boxed(effect.id)}
            class:dragging={dragFrom === i}
            class:gap-before={dragFrom !== null && dropGap === i}
            class:gap-after={dragFrom !== null && dropGap === i + 1 && i === effects.length - 1}
            ondragover={(e) => onRowDragOver(e, i)}
            ondrop={onRowDrop}
          >
            <EffectHeader
              {api}
              {effect}
              index={i}
              count={effects.length}
              selected={api.selectedEffectId === effect.id}
              step={playMode !== 'layer' && stepOf.has(effect.id) ? stepOf.get(effect.id)! + 1 : null}
              lastPlayed={playMode !== 'layer' && lastStep !== null && stepOf.get(effect.id) === lastStep}
              onGripDragStart={(e) => onGripDragStart(e, i)}
              onGripDragEnd={reset}
              onNudge={(d) => nudge(i, d)}
            />
            <EffectChain {api} {effect} />
            {#if boxed(effect.id)}<span class="box" aria-hidden="true"></span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
    --device-h: 240px;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    flex: none;
    padding: 0 var(--space-2) 0 var(--space-3);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .bar :global(.bar-icon) {
    color: var(--role-effect);
  }
  h2 {
    margin: 0;
    overflow: hidden;
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta {
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .bar :global(.add-effect) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    margin-left: auto;
    padding: 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 500;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .bar :global(.add-effect:hover:not(:disabled)),
  .bar :global(.add-effect[data-state='open']) {
    color: var(--ink);
    border-color: var(--border-strong);
  }
  .bar :global(.add-effect:disabled) {
    cursor: default;
    opacity: 0.5;
  }
  .empty {
    margin: auto;
    padding: var(--space-5);
    color: var(--text-faint);
    font-size: var(--text-xs);
    text-align: center;
    text-wrap: pretty;
  }
  .stack {
    display: flex;
    flex-direction: column;
  }
  .effect-row {
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  /* A highlighted Effect: one box round the whole of it — name bar and every card — drawn over
     the cards (they paint their own backgrounds) and never catching a click (Tim, 2026-10-01). */
  .effect-row.boxed {
    background: color-mix(in oklch, var(--accent) 6%, transparent);
  }
  .box {
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 2px solid var(--accent);
    border-radius: var(--radius-2);
    pointer-events: none;
  }
  .effect-row.dragging {
    opacity: 0.45;
  }
  .effect-row.gap-before::before,
  .effect-row.gap-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    height: 2px;
    background: var(--accent);
  }
  .effect-row.gap-before::before {
    top: -1px;
  }
  .effect-row.gap-after::after {
    bottom: -1px;
  }
  .master {
    display: flex;
    padding: var(--space-2);
    overflow-x: auto;
    scrollbar-width: thin;
  }
</style>
