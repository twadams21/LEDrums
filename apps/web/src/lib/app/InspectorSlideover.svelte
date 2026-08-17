<script lang="ts" module>
  /** The slideover's persisted width (the same pane size the docked Node Editor used, so an
      existing session keeps the width it chose). Exported because the canvas it lives in
      insets its own furniture — the `+` affordance, the lint strip, the add-popover's
      placement bounds — by exactly this much while it is open. */
  export const INSPECTOR_PANE = { key: 'triggerNodeEditorW', min: 280, max: 520, def: 340 } as const;
</script>

<script lang="ts">
  /* Inspector slideover — the selected node's editor, anchored to the right edge of the
     GRAPH CANVAS (Trent, 2026-08-17: "move the popover to be within the canvas. It is
     useful to be able to see the preview at the same time").

     So it is canvas furniture, not shell chrome: it mounts inside the canvas wrapper and a
     clip layer keeps it inside that box, leaving the drum preview and the Buses / Layers
     docks fully visible AND interactive while it is open. It is still an OVERLAY, never a
     push — it paints over the canvas surface, whose geometry never changes when the
     inspector opens or closes.

     Purely selection-keyed: a node selection opens it, clearing the selection closes it,
     and changing the selection swaps the content in place (no close/reopen flicker,
     because the panel never unmounts). Dismissal is therefore always "clear the
     selection": Escape here, the canvas background click in the view.

     z-order: above the canvas surface, the drop ring (4) and the lint strip (5), below the
     summoned add-node popover (7) — a surface the user just asked for wins. */
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

  const width = $derived(store.paneSizes[INSPECTOR_PANE.key] ?? INSPECTOR_PANE.def);
  const setWidth = (v: number): void => {
    store.paneSizes = { ...store.paneSizes, [INSPECTOR_PANE.key]: v };
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

<!-- Clip layer: the panel slides in from the canvas's right edge and must never paint
     outside it (that is the whole point of the F2 amendment). Inert to the pointer so the
     canvas underneath keeps every gesture except where the panel itself sits. -->
<div class="so-clip">
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
        min={INSPECTOR_PANE.min}
        max={INSPECTOR_PANE.max}
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
</div>

<style>
  .so-clip {
    position: absolute;
    inset: 0;
    z-index: 6;
    overflow: hidden;
    pointer-events: none;
    border-radius: var(--radius-2);
  }
  .slideover {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    bottom: var(--space-3);
    /* never wider than the canvas it floats in, however far the splitter was dragged */
    width: min(var(--slideover-w, 340px), calc(100% - var(--space-8)));
    display: flex;
    flex-direction: column;
    min-height: 0;
    pointer-events: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    overflow: hidden;
    /* the same card language as the add-node popover: it floats ON the canvas, so the
       shadow is what separates it from the graph running underneath. */
    box-shadow: var(--shadow-3);
    translate: calc(100% + var(--space-3)) 0;
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
