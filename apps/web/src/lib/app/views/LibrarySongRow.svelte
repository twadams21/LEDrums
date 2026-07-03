<script lang="ts">
  /* One row in the "Song Library" pool group — a shared library song across shows. Import adds a
     live reference to the active show (disabled, with an "In this show" badge, once referenced);
     Delete is gated by the store's guard (disabled while any show references it, the verb naming
     the blocking count). Rename edits the canonical copy and propagates. Composes EditableRow,
     mirroring SongRow / LibraryRefRow. Usage counts + `deletable` come from the pure
     `librarySongRows` view-model, so this file stays thin UI. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { LibrarySongRow } from './objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import LibraryBig from '@lucide/svelte/icons/library-big';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Import from '@lucide/svelte/icons/import';
  import X from '@lucide/svelte/icons/x';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, row }: { store: TriggerLab; row: LibrarySongRow } = $props();

  let editing = $state(false);
  const usedByLabel = $derived(
    row.usedByCount === 0
      ? 'Not used by any show'
      : `Used by ${row.usedByCount} ${row.usedByCount === 1 ? 'show' : 'shows'}`,
  );
  // The delete verb carries its own block reason so the disabled item explains itself.
  const deleteLabel = $derived(row.deletable ? 'Delete' : `Delete — ${usedByLabel.toLowerCase()}`);

  // Import when the active show doesn't reference it yet; once it does, the same slot becomes
  // "Remove from show" (drops the ref without cloning — the inverse of import).
  const actions = $derived<ContextMenuAction[]>([
    row.inThisShow
      ? { label: 'Remove from show', icon: X, onSelect: () => store.removeSongReference(row.id) }
      : { label: 'Import to show', icon: Import, onSelect: () => store.importSongReference(row.id) },
    { label: deleteLabel, icon: Trash2, danger: true, disabled: !row.deletable, onSelect: () => store.deleteLibrarySong(row.id) },
  ]);
</script>

<EditableRow
  icon={LibraryBig}
  label={row.name}
  secondary={usedByLabel}
  bind:editing
  onCommit={(name) => store.renameLibrarySong(row.id, name)}
  {actions}
  renameLabel="Library song name"
>
  {#snippet trailing()}
    {#if row.inThisShow}
      <StatusPill tone="accent" label="In this show" title={row.usedByNames.join(', ')} />
    {/if}
  {/snippet}
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename library song" size={13} onclick={() => (editing = true)} />
    {#if row.inThisShow}
      <IconButton icon={X} label="Remove from show" size={13} onclick={() => store.removeSongReference(row.id)} />
    {:else}
      <IconButton icon={Import} label="Import to show" size={13} onclick={() => store.importSongReference(row.id)} />
    {/if}
    <IconButton
      icon={Trash2}
      label={row.deletable ? 'Delete from library' : usedByLabel}
      size={13}
      disabled={!row.deletable}
      onclick={() => store.deleteLibrarySong(row.id)}
    />
  {/snippet}
</EditableRow>
