<script lang="ts">
  /* Add-node palette as an ON-CANVAS POPOVER (decided by Trent, 2026-08-17) — summoned at
     the cursor by a canvas right-click, or at the canvas centre by the `+` affordance. The
     node lands where the popover was invoked, so choosing a node IS choosing its position.

     It is a FLAT list of node types and one click adds (F2 amendment): no search, no
     taxonomy to browse, no second click. The families whose members differ by subtype
     (Effect / Modifier / Modulate) land on their default and are re-typed in the node's
     inspector — see `add-node-taxonomy.ts` for the list and where its icons come from.

     Non-modal on purpose: it must not trap focus or dim the graph behind it — hence
     `role="group"` rather than `role="dialog"`, which `overlay-dismiss` reads as "a modal
     is covering me" and which would make the popover refuse its own Escape. */
  import { tick } from 'svelte';
  import type { NodeKind } from '../../trigger-lab/sim';
  import {
    ADD_NODE_DRAG_TYPE,
    ADD_NODE_TYPES,
    encodeAddDragPayload,
    type AddNodeType,
  } from './add-node-taxonomy';
  import { clampPopoverPosition } from './popover-placement';
  import { isEditableShortcutTarget } from '../primary-shortcut';
  import { isModalDialogOpen, shouldDismissOnEscape } from '../overlay-dismiss';
  import NodeIconChip from './NodeIconChip.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Cable from '@lucide/svelte/icons/cable';
  import X from '@lucide/svelte/icons/x';

  let {
    at,
    bounds,
    types = ADD_NODE_TYPES,
    disabled = false,
    wiring = false,
    onAdd,
    onClose,
  }: {
    /** Canvas-local px the popover was summoned at (pointer, or the canvas centre). */
    at: { x: number; y: number };
    /** The region the popover is kept inside — the canvas box, minus anything covering it. */
    bounds: { w: number; h: number };
    /** The node types on offer; defaults to the registry-derived list. */
    types?: readonly AddNodeType[];
    /** Read-only viewer: browsing allowed, adding disabled. */
    disabled?: boolean;
    /** F8: summoned holding a wire a drag released in empty space — the pick takes that wire.
        Says so in the header, and drops drag-to-place (which would land a node WITHOUT the
        wire); `types` is already filtered to what the wire can reach. */
    wiring?: boolean;
    onAdd: (kind: NodeKind) => void;
    onClose: () => void;
  } = $props();

  /** Declared, not measured: a fixed footprint keeps placement deterministic (and testable).
      The list is a known length, so the height is the rows plus the header. */
  const ROW_H = 32;
  const CHROME_H = 48;
  const W = 264;
  const size = $derived({
    w: W,
    h: Math.min(CHROME_H + types.length * ROW_H, Math.max(160, bounds.h - 16)),
  });
  const pos = $derived(clampPopoverPosition(at.x, at.y, size, bounds));

  let el = $state<HTMLElement | null>(null);

  // Land focus on the first row: the list IS the whole surface now, so arrow keys walk it
  // and Enter adds — a keyboard path that needs no pointer trip to the canvas.
  $effect(() => {
    if (!el) return;
    void tick().then(() => rows()[0]?.focus());
  });

  function rows(): HTMLButtonElement[] {
    return el ? Array.from(el.querySelectorAll<HTMLButtonElement>('button.row')) : [];
  }
  /** Arrow / Home / End walk the list (roving focus), the way a menu does. */
  function onListKeydown(e: KeyboardEvent): void {
    const all = rows();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to =
      e.key === 'ArrowDown' ? (i + 1) % all.length
      : e.key === 'ArrowUp' ? (i - 1 + all.length) % all.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    all[to]?.focus();
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    // Escape inside the popover still closes it — nothing in here holds an edit to revert.
    const editable = isEditableShortcutTarget(e.target) && !el?.contains(e.target as Node);
    if (!shouldDismissOnEscape({ key: e.key, isEditableTarget: editable, modalOpen: isModalDialogOpen(document) })) {
      return;
    }
    e.preventDefault();
    onClose();
  }

  function onWindowPointerDown(e: PointerEvent): void {
    if (el && !el.contains(e.target as Node)) onClose();
  }

  function add(kind: NodeKind): void {
    if (disabled) return;
    onAdd(kind);
    onClose();
  }
  /** Drag a row onto the canvas to place the node at the DROP point instead of here. */
  function dragRow(e: DragEvent, kind: NodeKind): void {
    if (disabled) return;
    e.dataTransfer?.setData(ADD_NODE_DRAG_TYPE, encodeAddDragPayload(kind));
    e.dataTransfer?.setData('text/plain', kind);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div
  bind:this={el}
  class="add-popover"
  role="group"
  aria-label="Add node palette"
  style:--add-row-cursor={wiring ? 'pointer' : 'grab'}
  style:left={`${pos.x}px`}
  style:top={`${pos.y}px`}
  style:width={`${size.w}px`}
  style:height={`${size.h}px`}
>
  <PanelHeader icon={wiring ? Cable : Plus} title={wiring ? 'Add & wire' : 'Add node'}>
    <IconButton icon={X} label="Close" tooltipSide="left" onclick={onClose} />
  </PanelHeader>
  <div class="rows">
    {#each types as t (t.kind)}
      <button
        type="button"
        class="row"
        {disabled}
        title={`Add ${t.label}`}
        draggable={!disabled && !wiring}
        ondragstart={(e) => dragRow(e, t.kind)}
        onkeydown={onListKeydown}
        onclick={() => add(t.kind)}
      >
        <NodeIconChip icon={t.icon} tint={t.tint} size={22} />
        <span class="nm">{t.label}</span>
        <span class="hint">{t.hint}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .add-popover {
    position: absolute;
    /* above the lint strip (5) and the drop ring (4), and above the inspector slideover (6)
       — it is the surface the user just summoned, inside the canvas's own stacking context. */
    z-index: 7;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-3);
    overflow: hidden;
    transform-origin: top left;
    animation: ap-in var(--dur-120) var(--ease-control);
  }
  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-1);
  }
  /* One line per type: chip, name, and the qualifier trailing in a quieter voice — the row
     is the whole control, so it fills the width and the whole row is the hit target. */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-1);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    color: var(--text-muted);
    text-align: left;
    cursor: var(--add-row-cursor, grab);
    transition:
      background-color var(--dur-120) ease,
      border-color var(--dur-120) ease,
      color var(--dur-120) ease;
  }
  .row:hover:not(:disabled),
  .row:focus-visible {
    background: var(--surface-2);
    border-color: var(--border-faint);
    color: var(--ink);
  }
  .row:active:not(:disabled) {
    scale: 0.98;
  }
  .row[draggable='true']:active:not(:disabled) {
    cursor: grabbing;
  }
  .row:disabled {
    cursor: default;
    opacity: 0.54;
  }
  .nm {
    flex: none;
    font-size: var(--text-xs);
    font-weight: 700;
  }
  .hint {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  @keyframes ap-in {
    from {
      opacity: 0;
      scale: 0.97;
    }
    to {
      opacity: 1;
      scale: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .add-popover {
      animation: none;
    }
    .row:active:not(:disabled) {
      scale: 1;
    }
  }
</style>
