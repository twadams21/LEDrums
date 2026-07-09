<script lang="ts">
  /* One graph row inside a section column. Clicking opens the graph on the Trigger canvas
     (and activates its section); the trailing dot marks a graph reused in another section.
     CRUD via the right-click menu (rename / duplicate / remove-from-section / delete) with a
     hover quick-action for the common "remove from section". */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Song, SetlistSection } from '../setlist';
  import { isReused } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusDot from '../../ui/StatusDot.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';

  let {
    store,
    shell,
    song,
    section,
    graphKey,
    onDragStart,
    onDragEnd,
  }: {
    store: TriggerLab;
    shell: ShellStore;
    song: Song;
    section: SetlistSection;
    graphKey: string;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  } = $props();

  let editing = $state(false);
  const current = $derived(store.activeSectionId === section.id && store.selectedPadKey === graphKey);
  const reused = $derived(isReused(song, graphKey));
  const sub = $derived(describeTriggerSource(store.triggerSource(graphKey), store.drums).sub);

  function open(): void {
    store.selectGraphInSection(section.id, graphKey);
    shell.setView('trigger');
  }
  function removeFromSection(): void {
    store.removeGraphFromSection(section.id, graphKey);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateGraph(graphKey) },
    { label: 'Remove from section', icon: X, onSelect: removeFromSection },
    { label: 'Delete graph', icon: Trash2, danger: true, onSelect: () => store.deleteGraph(graphKey) },
  ]);
</script>

<div
  class="graph-drag"
  role="listitem"
  data-graph-row
  draggable={store.canEdit && !editing}
  aria-label={`Drag ${store.graphLabel(graphKey)}`}
  ondragstart={onDragStart}
  ondragend={onDragEnd}
>
  <EditableRow
    icon={Workflow}
    label={store.graphLabel(graphKey)}
    secondary={sub}
    active={current}
    bind:editing
    onclick={open}
    onCommit={(name) => store.renameGraph(graphKey, name)}
    {actions}
    renameLabel="Graph name"
  >
    {#snippet trailing()}
      {#if reused}<StatusDot tone="accent" />{/if}
    {/snippet}
    {#snippet quickActions()}
      <IconButton icon={X} label="Remove from section" size={12} onclick={removeFromSection} />
    {/snippet}
  </EditableRow>
</div>

<style>
  .graph-drag {
    min-height: 40px;
    border-radius: var(--radius-2);
    cursor: grab;
  }
  .graph-drag:active {
    cursor: grabbing;
  }
</style>
