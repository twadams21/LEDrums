<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). The Patch Graph as a LARGE MODAL (not a
     fullscreen takeover) opened from Settings. Hosts the real PatchGraphView with
     its canvas-side Inspector dock + header hidden via CSS; double-clicking a
     node opens that node's Inspector as a stacked modal instead. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import PatchGraphView from '../views/PatchGraphView.svelte';
  import Inspector from '../docks/Inspector.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import { nodeIdAtEvent } from '../views/flow-dom';
  import Cable from '@lucide/svelte/icons/cable';
  import X from '@lucide/svelte/icons/x';

  let { store, shell, open, onClose }: { store: TriggerLab; shell: ShellStore; open: boolean; onClose: () => void } = $props();

  let inspectorOpen = $state(false);

  /** Double-click on a canvas node → open its Inspector as a modal. Single click
      still selects (the real view wires that) but no dock is visible here. */
  function onDblClick(e: MouseEvent): void {
    const id = nodeIdAtEvent(e);
    if (!id) return;
    shell.select({ kind: 'patch', nodeId: id });
    inspectorOpen = true;
  }

  function closeInspector(): void {
    inspectorOpen = false;
    shell.clearSelection();
  }
</script>

<Dialog {open} {onClose} title="Patch Graph" layer={2} class="proto-patch-modal">
  <header class="head">
    <span class="ttl"><Cable size={15} aria-hidden="true" /> Patch Graph</span>
    <span class="hint">Double-click a node to edit it</span>
    <IconButton icon={X} label="Close" size={15} onclick={onClose} />
  </header>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas-host" ondblclick={onDblClick}>
    {#if open}
      <PatchGraphView {store} {shell} />
    {/if}
  </div>
</Dialog>

<Dialog open={inspectorOpen} onClose={closeInspector} title="Node inspector" layer={3} class="proto-node-inspector">
  <div class="insp-host">
    <Inspector {store} {shell} />
  </div>
</Dialog>

<style>
  :global(.proto-patch-modal) {
    width: min(1500px, calc(100vw - 40px));
    height: calc(100vh - 40px);
    max-height: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .ttl {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .head :global(button:last-child) {
    margin-left: auto;
  }
  .canvas-host {
    flex: 1;
    min-height: 0;
    padding: var(--space-2);
  }
  /* Hide the hosted view's own header + inspector dock; the canvas takes the full modal. */
  .canvas-host :global(.patch-view) {
    grid-template-rows: minmax(0, 1fr);
  }
  .canvas-host :global(.patch-view .phead) {
    display: none;
  }
  .canvas-host :global(.patch-view .prow) {
    grid-template-columns: minmax(0, 1fr);
  }
  .canvas-host :global(.patch-view .idock) {
    display: none;
  }

  :global(.proto-node-inspector) {
    width: min(400px, calc(100vw - 48px));
    height: min(640px, calc(100vh - 96px));
  }
  .insp-host {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
