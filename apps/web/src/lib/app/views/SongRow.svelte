<script lang="ts">
  /* One Songs-tab row in the Objects view. Wraps the EditableRow primitive (inline rename +
     right-click verbs) with the song's per-type CRUD: click activates, the trailing dot marks
     the live song, and Delete is gated to keep at least one song. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { Song } from '../setlist';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusDot from '../../ui/StatusDot.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Copy from '@lucide/svelte/icons/copy';
  import BookPlus from '@lucide/svelte/icons/book-plus';
  import Check from '@lucide/svelte/icons/check';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Play from '@lucide/svelte/icons/play';

  let { store, song }: { store: TriggerLab; song: Song } = $props();

  // "Add to library" exports the song's dependency closure into the shared Song Library as a
  // new pool entry (the show keeps its local copy — importing a live reference is a separate,
  // explicit step). A brief tick confirms the export landed.
  let justAdded = $state(false);
  let addedTimer: ReturnType<typeof setTimeout> | null = null;
  function addToLibrary(): void {
    if (store.exportSongToLibrary(song.id) == null) return;
    justAdded = true;
    if (addedTimer) clearTimeout(addedTimer);
    addedTimer = setTimeout(() => (justAdded = false), 1400);
  }

  let editing = $state(false);
  const active = $derived(store.activeSongId === song.id);
  const canDelete = $derived(store.songs.length > 1);
  const sub = $derived(
    `${song.sections.length} ${song.sections.length === 1 ? 'section' : 'sections'}`,
  );

  function remove(): void {
    store.removeSong(song.id);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Activate', icon: Play, onSelect: () => store.setActiveSong(song.id) },
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateSong(song.id) },
    { label: 'Copy', icon: Copy, onSelect: () => void store.copySongToClipboard(song.id) },
    { label: 'Add to library', icon: BookPlus, onSelect: addToLibrary },
    { label: 'Delete', icon: Trash2, danger: true, disabled: !canDelete, onSelect: remove },
  ]);
</script>

<EditableRow
  icon={ListMusic}
  label={song.name}
  secondary={sub}
  {active}
  bind:editing
  onclick={() => store.setActiveSong(song.id)}
  onCommit={(name) => store.renameSong(song.id, name)}
  {actions}
  renameLabel="Song name"
>
  {#snippet trailing()}
    {#if active}<StatusDot tone="accent" />{/if}
  {/snippet}
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename song" size={13} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label="Duplicate song" size={13} onclick={() => store.duplicateSong(song.id)} />
    <IconButton icon={Copy} label="Copy song to clipboard" size={13} onclick={() => void store.copySongToClipboard(song.id)} />
    <IconButton
      icon={justAdded ? Check : BookPlus}
      label={justAdded ? 'Added to library' : 'Add to library'}
      size={13}
      onclick={addToLibrary}
    />
    <IconButton icon={Trash2} label="Delete song" size={13} disabled={!canDelete} onclick={remove} />
  {/snippet}
</EditableRow>
