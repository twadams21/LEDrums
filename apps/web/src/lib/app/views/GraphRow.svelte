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
  const canMutate = $derived(store.canMutateGraph(graph.key));
  const canCopy = $derived(store.canCopyGraph(graph.key));
  const blockedReason = $derived(store.selectedGraphEditBlockReason ?? 'This graph is read-only');

  function remove(): void {
    store.deleteGraph(graph.key);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Open', icon: SquarePen, onSelect: () => onOpen(graph.key) },
    { label: canCopy ? 'Duplicate' : `Duplicate — ${blockedReason}`, icon: CopyPlus, disabled: !canCopy, onSelect: () => store.duplicateGraph(graph.key) },
    { label: 'Copy', icon: Copy, onSelect: () => void store.copyGraphToClipboard(graph.key) },
    { label: canMutate ? 'Delete' : `Delete — ${blockedReason}`, icon: Trash2, danger: true, disabled: !canMutate, onSelect: remove },
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
  renameDisabled={!canMutate}
  renameDisabledLabel={blockedReason}
>
  {#snippet quickActions()}
    <IconButton icon={Pencil} label={canMutate ? 'Rename graph' : `Rename disabled — ${blockedReason}`} size={13} disabled={!canMutate} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label={canCopy ? 'Duplicate graph' : `Duplicate disabled — ${blockedReason}`} size={13} disabled={!canCopy} onclick={() => store.duplicateGraph(graph.key)} />
    <IconButton icon={Copy} label="Copy graph to clipboard" size={13} onclick={() => void store.copyGraphToClipboard(graph.key)} />
    <IconButton icon={Trash2} label={canMutate ? 'Delete graph' : `Delete disabled — ${blockedReason}`} size={13} disabled={!canMutate} onclick={remove} />
  {/snippet}
</EditableRow>
