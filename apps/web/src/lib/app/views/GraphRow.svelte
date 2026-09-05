<script lang="ts">
  /* One Graphs-tab row in the Objects view. A trigger graph (need not belong to a section);
     clicking it opens the Trigger editor via `onOpen`. The sub-line is the graph's resolved
     trigger source (e.g. "Kick · center", "MIDI D2"). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { GraphRow as GraphRowVM } from './objects-view';
  import { describeTriggerSource } from '../trigger-source-label';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Copy from '@lucide/svelte/icons/copy';
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
  const canEdit = $derived(store.canEditActiveSong);
  const blockedReason = $derived(store.activeSongEditBlockReason ?? 'Library graph is read-only');

  function remove(): void {
    store.deleteGraph(graph.key);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Open', icon: SquarePen, onSelect: () => onOpen(graph.key) },
    { label: canEdit ? 'Duplicate' : `Duplicate — ${blockedReason}`, icon: CopyPlus, disabled: !canEdit, onSelect: () => store.duplicateGraph(graph.key) },
    { label: 'Copy', icon: Copy, onSelect: () => void store.copyGraphToClipboard(graph.key) },
    { label: canEdit ? 'Delete' : `Delete — ${blockedReason}`, icon: Trash2, danger: true, disabled: !canEdit, onSelect: remove },
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
  renameDisabled={!canEdit}
  renameDisabledLabel={blockedReason}
>
  {#snippet quickActions()}
    <IconButton icon={Pencil} label={canEdit ? 'Rename graph' : `Rename disabled — ${blockedReason}`} size={13} disabled={!canEdit} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label={canEdit ? 'Duplicate graph' : `Duplicate disabled — ${blockedReason}`} size={13} disabled={!canEdit} onclick={() => store.duplicateGraph(graph.key)} />
    <IconButton icon={Copy} label="Copy graph to clipboard" size={13} onclick={() => void store.copyGraphToClipboard(graph.key)} />
    <IconButton icon={Trash2} label={canEdit ? 'Delete graph' : `Delete disabled — ${blockedReason}`} size={13} disabled={!canEdit} onclick={remove} />
  {/snippet}
</EditableRow>
