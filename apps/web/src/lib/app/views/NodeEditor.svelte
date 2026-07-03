<script lang="ts">
  /* Node Editor — the graph views' side drawer (approved wave-3 shell). Two tabs on
     one full-height panel beside the canvas: **Add** (the searchable node palette)
     and **Inspector** (the selected node's editor). Replaces the floating canvas
     palette, the two add modals, and the short right-dock inspector. The owning
     view binds `tab` and flips it to 'inspector' when a node is selected (the
     prototype's click-a-node → inspect behaviour). */
  import type { Snippet } from 'svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import PencilRuler from '@lucide/svelte/icons/pencil-ruler';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

  export type NodeEditorTab = 'add' | 'inspector';

  let {
    tab = $bindable('add'),
    add,
    inspector,
  }: {
    tab?: NodeEditorTab;
    add: Snippet;
    inspector: Snippet;
  } = $props();

  const TABS = [
    { value: 'add', label: 'Add node', icon: Plus },
    { value: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
  ];
</script>

<aside class="node-editor" aria-label="Node editor">
  <PanelHeader icon={PencilRuler} title="Node Editor">
    <SegmentedControl value={tab} options={TABS} onChange={(v) => (tab = v as NodeEditorTab)} ariaLabel="Node editor tab" />
  </PanelHeader>
  <div class="ne-body">
    {#if tab === 'add'}
      {@render add()}
    {:else}
      {@render inspector()}
    {/if}
  </div>
</aside>

<style>
  .node-editor {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .ne-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* the inspector/add content scrolls itself; keep the drawer chrome fixed */
  .ne-body > :global(*) {
    flex: 1;
    min-height: 0;
  }
</style>
