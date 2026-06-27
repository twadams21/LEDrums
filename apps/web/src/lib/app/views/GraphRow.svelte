<script lang="ts">
  /* One Graphs-tab row in the Objects view. A trigger graph (need not belong to a section);
     clicking it opens the Trigger editor via `onOpen`. The sub-line is the graph's resolved
     trigger source (e.g. "Kick · center", "MIDI note 38"). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { GraphRow as GraphRowVM } from './objects-view';
  import { describeTriggerSource } from '../trigger-source-label';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import SquarePen from '@lucide/svelte/icons/square-pen';

  let {
    store,
    graph,
    active = false,
    onOpen,
  }: { store: TriggerLab; graph: GraphRowVM; active?: boolean; onOpen: (key: string) => void } = $props();

  let editing = $state(false);
  const sub = $derived(describeTriggerSource(store.triggerSource(graph.key), store.drums).sub);

  function remove(): void {
    store.deleteGraph(graph.key);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Open', icon: SquarePen, onSelect: () => onOpen(graph.key) },
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateGraph(graph.key) },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: remove },
  ]);
</script>

<EditableRow
  icon={Workflow}
  label={graph.label}
  secondary={sub}
  {active}
  bind:editing
  onclick={() => onOpen(graph.key)}
  onCommit={(name) => store.renameGraph(graph.key, name)}
  {actions}
  renameLabel="Graph name"
>
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename graph" size={13} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label="Duplicate graph" size={13} onclick={() => store.duplicateGraph(graph.key)} />
    <IconButton icon={Trash2} label="Delete graph" size={13} onclick={remove} />
  {/snippet}
</EditableRow>
