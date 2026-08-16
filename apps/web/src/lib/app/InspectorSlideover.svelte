<script lang="ts">
  /* Inspector slideover — the selected node's editor, anchored to the RIGHT EDGE OF THE
     WINDOW and painting above all app chrome (decided by Trent, 2026-08-17).

     It deliberately overlaps the visualiser / Buses-Layers docks and the chrome bars
     rather than living in the Trigger view's grid: the graph canvas geometry must NEVER
     change when the inspector opens or closes, so this is an OVERLAY, not a push. That is
     why it mounts here at the shell layer (beside the other summoned overlays) and not
     inside `TriggerGraphView` — a grid column cannot paint over its own shell.

     Purely selection-keyed: a node selection opens it, clearing the selection closes it,
     and changing the selection swaps the content in place (no close/reopen flicker,
     because the panel never unmounts). Dismissal is therefore always "clear the
     selection": Escape here, the canvas background click in the view.

     z-order: `--z-overlay` — above the docks (`--z-docked`) and the sticky bars, below
     `--z-modal-backdrop` so a real dialog still covers it. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import { isEditableShortcutTarget } from './primary-shortcut';
  import { isModalDialogOpen, shouldDismissOnEscape } from './overlay-dismiss';
  import Inspector from './docks/Inspector.svelte';
  import PanelHeader from '../ui/PanelHeader.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Splitter from '../ui/Splitter.svelte';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import X from '@lucide/svelte/icons/x';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const open = $derived(shell.selection?.kind === 'node');

  /** Width: the same persisted pane size (and clamps) the docked Node Editor drawer used,
      so an existing session keeps the width it had chosen. */
  const WIDTH = { key: 'triggerNodeEditorW', min: 280, max: 520, def: 340 };
  const width = $derived(store.paneSizes[WIDTH.key] ?? WIDTH.def);
  const setWidth = (v: number): void => {
    store.paneSizes = { ...store.paneSizes, [WIDTH.key]: v };
  };

  function onWindowKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (!shouldDismissOnEscape({
      key: e.key,
      isEditableTarget: isEditableShortcutTarget(e.target),
      modalOpen: shell.settingsPane !== null || isModalDialogOpen(document),
    })) {
      return;
    }
    e.preventDefault();
    shell.clearSelection();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Always mounted so the slide animates BOTH ways and a selection change swaps content in
     place. Closed it is inert: `inert` removes it from the tab order and hit-testing, and
     `visibility:hidden` (delayed to the end of the slide-out) stops it painting. -->
<aside
  class="slideover"
  class:open
  style:--slideover-w={`${width}px`}
  aria-label="Inspector"
  inert={!open}
>
  {#if open}
    <Splitter
      orientation="vertical"
      size={width}
      min={WIDTH.min}
      max={WIDTH.max}
      invert
      label="Resize inspector"
      onResize={setWidth}
      style="left: 0; top: 0; bottom: 0; transform: translateX(-50%);"
    />
  {/if}
  <PanelHeader icon={SlidersHorizontal} title="Inspector">
    <IconButton icon={X} label="Close inspector" tooltipSide="left" onclick={() => shell.clearSelection()} />
  </PanelHeader>
  <div class="so-body">
    <Inspector {store} {shell} />
  </div>
</aside>

<style>
  .slideover {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-overlay);
    width: var(--slideover-w, 340px);
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--border-faint);
    /* A long, soft left-side shadow is what sells "floating above the docks" — the panel
       has no gap around it, so the shadow is the only separation from what it covers. */
    box-shadow: -12px 0 28px rgb(0 0 0 / 0.35);
    translate: 100% 0;
    visibility: hidden;
    transition:
      translate var(--dur-220) var(--ease-control),
      visibility 0s linear var(--dur-220);
  }
  .slideover.open {
    translate: 0 0;
    visibility: visible;
    transition:
      translate var(--dur-220) var(--ease-control),
      visibility 0s;
  }
  .so-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* the inspector content scrolls itself; the panel chrome stays put */
  .so-body > :global(*) {
    flex: 1;
    min-height: 0;
  }
  /* Reduced motion: no slide. The panel still needs to arrive and leave, so it fades —
     `--dur-*` is zeroed under this query, hence the literal duration. */
  @media (prefers-reduced-motion: reduce) {
    .slideover {
      translate: 0 0;
      opacity: 0;
      transition:
        opacity 120ms linear,
        visibility 0s linear 120ms;
    }
    .slideover.open {
      opacity: 1;
      transition:
        opacity 120ms linear,
        visibility 0s;
    }
  }
</style>
