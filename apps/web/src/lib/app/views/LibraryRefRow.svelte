<script lang="ts">
  /* One "This show" setlist row that is a REFERENCE to a Song Library song (not a local copy).
     The name/sections resolve from the library, so a rename here edits the LIBRARY copy and
     propagates to every show that references it (canonical). A "Library" badge marks the link;
     "Detach copy" (store.detachSongReference) clones the closure into this show as an editable
     local song and severs the link — after which it renders as an ordinary SongRow. Composes
     the shared EditableRow primitive, like SongRow. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShowSongRow } from './objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Unlink from '@lucide/svelte/icons/unlink';
  import X from '@lucide/svelte/icons/x';

  let { store, row }: { store: TriggerLab; row: ShowSongRow } = $props();

  let editing = $state(false);
  const sub = $derived(`${row.sectionCount} ${row.sectionCount === 1 ? 'section' : 'sections'}`);

  /** Clone the referenced closure into this show as a local song and jump to it — it's now
      editable in place, independent of the library. */
  function detach(): void {
    const localId = store.detachSongReference(row.id);
    if (localId) store.setActiveSong(localId);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Detach copy', icon: Unlink, onSelect: detach },
    { label: 'Remove from show', icon: X, onSelect: () => store.removeSongReference(row.id) },
  ]);
</script>

<EditableRow
  icon={ListMusic}
  label={row.name}
  secondary={sub}
  bind:editing
  onCommit={(name) => store.renameLibrarySong(row.id, name)}
  {actions}
  renameLabel="Library song name"
>
  {#snippet trailing()}
    <StatusPill tone="muted" label="Library" title="References a Song Library song — edits propagate" />
  {/snippet}
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename (edits library copy)" size={13} onclick={() => (editing = true)} />
    <IconButton icon={Unlink} label="Detach copy" size={13} onclick={detach} />
    <IconButton icon={X} label="Remove from show" size={13} onclick={() => store.removeSongReference(row.id)} />
  {/snippet}
</EditableRow>
