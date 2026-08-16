<script lang="ts">
  /* Add-node palette as an ON-CANVAS POPOVER (decided by Trent, 2026-08-17) — summoned at
     the cursor by a canvas right-click, or at the canvas centre by the `+` affordance. The
     node lands where the popover was invoked, so choosing a node IS choosing its position.

     This is a re-housing, not a rewrite: the palette inside is the same `AddPalette` (same
     taxonomy, same search, same drag-to-canvas payloads) that used to fill the Node Editor
     drawer's Add tab. Only the container changed — from a permanent column to a transient
     surface that costs the canvas nothing when it is closed.

     Non-modal on purpose: it must not trap focus or dim the graph behind it — hence
     `role="group"` rather than `role="dialog"`, which `overlay-dismiss` reads as "a modal
     is covering me" and which would make the popover refuse its own Escape. */
  import { tick } from 'svelte';
  import AddPalette, { type AddGroup } from './AddPalette.svelte';
  import { clampPopoverPosition } from './popover-placement';
  import { isEditableShortcutTarget } from '../primary-shortcut';
  import { isModalDialogOpen, shouldDismissOnEscape } from '../overlay-dismiss';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

  let {
    at,
    bounds,
    groups,
    disabled = false,
    onAdd,
    onClose,
  }: {
    /** Canvas-local px the popover was summoned at (pointer, or the canvas centre). */
    at: { x: number; y: number };
    /** The canvas wrapper's box — the popover is kept inside it. */
    bounds: { w: number; h: number };
    groups: readonly AddGroup[];
    /** Read-only viewer: browsing allowed, adding disabled (mirrors the palette's own rule). */
    disabled?: boolean;
    onAdd: (id: string, groupKey: string) => void;
    onClose: () => void;
  } = $props();

  /** Declared, not measured: a fixed footprint keeps placement deterministic (and testable)
      and stops the popover resizing under the pointer as search narrows the list. */
  const W = 300;
  const H = 400;
  const size = $derived({ w: W, h: Math.min(H, Math.max(180, bounds.h - 16)) });
  const pos = $derived(clampPopoverPosition(at.x, at.y, size, bounds));

  let el = $state<HTMLElement | null>(null);

  // Land focus in the search field: typing is the fast path through a taxonomy this size,
  // and it also means the digit keys type instead of firing section graphs (App.svelte's
  // workspace keys skip editable targets).
  $effect(() => {
    if (!el) return;
    void tick().then(() => {
      el?.querySelector<HTMLInputElement>('input[aria-label="Search nodes"]')?.focus();
    });
  });

  function onWindowKeydown(e: KeyboardEvent): void {
    // Escape inside the popover's own search field still closes it — the field has nothing
    // to revert, and trapping Escape there would strand the palette open.
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

  function add(id: string, groupKey: string): void {
    onAdd(id, groupKey);
    onClose();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div
  bind:this={el}
  class="add-popover"
  role="group"
  aria-label="Add node palette"
  style:left={`${pos.x}px`}
  style:top={`${pos.y}px`}
  style:width={`${size.w}px`}
  style:height={`${size.h}px`}
>
  <PanelHeader icon={Plus} title="Add node">
    <IconButton icon={X} label="Close" tooltipSide="left" onclick={onClose} />
  </PanelHeader>
  <div class="ap-body">
    <AddPalette {groups} onAdd={add} {disabled} />
  </div>
</div>

<style>
  .add-popover {
    position: absolute;
    /* above the lint strip (5) and the drop ring (4), inside the canvas's own stacking
       context — this is canvas furniture, not shell chrome. */
    z-index: 6;
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
  .ap-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ap-body > :global(*) {
    flex: 1;
    min-height: 0;
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
  }
</style>
