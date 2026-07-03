<script lang="ts">
  /* Left-rail song list — the show's setlist. Songs are the top of the setlist hierarchy;
     selecting one makes its sections the columns of the Sections view. Shared by Author + Perform.
     A performer can add a song (+ in the header), and right-click a row to Rename (inline),
     Duplicate, or Delete it — all persisted via the store's autosave.

     The list is the RESOLVED setlist (S42): local authored songs PLUS referenced Song Library
     songs, so an imported reference is selectable + playable here. A reference is badged "Library";
     its verbs act on the canonical copy (Rename) or the link (Detach copy / Remove from show)
     rather than the local song ops. The last-LOCAL-song delete guard is unchanged.

     Each row is a shared `lib/ui/EditableRow` (ListItem + inline CommitInput rename +
     right-click ContextMenu); the rename/select/verb wiring lives in the primitive. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { showSongRows, type ShowSongRow } from '../views/objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Unlink from '@lucide/svelte/icons/unlink';
  import X from '@lucide/svelte/icons/x';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, heading = true }: { store: TriggerLab; heading?: boolean } = $props();

  const rows = $derived(showSongRows(store.songs, store.resolvedSongs));
  // The last-song guard counts LOCAL songs only — a reference isn't a local song, and removing it
  // (below) drops the ref, never the local setlist.
  const canDeleteLocal = $derived(store.songs.length > 1);

  function detach(id: string): void {
    const localId = store.detachSongReference(id);
    if (localId) store.setActiveSong(localId);
  }

  /** The right-click verbs for one row, by origin — local song CRUD vs library-reference verbs. */
  function rowActions(row: ShowSongRow): ContextMenuAction[] {
    if (row.origin === 'reference') {
      return [
        { label: 'Detach copy', icon: Unlink, onSelect: () => detach(row.id) },
        { label: 'Remove from show', icon: X, onSelect: () => store.removeSongReference(row.id) },
      ];
    }
    return [
      { label: 'Duplicate', icon: Copy, onSelect: () => store.duplicateSong(row.id) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        disabled: !canDeleteLocal, // the app always keeps one LOCAL song
        onSelect: () => store.removeSong(row.id),
      },
    ];
  }

  /** Rename routes to the canonical library copy for a reference (propagates), else the local song. */
  function commitRename(row: ShowSongRow, name: string): void {
    if (row.origin === 'reference') store.renameLibrarySong(row.id, name);
    else store.renameSong(row.id, name);
  }
</script>

<div class="songrail">
  <div class="head">
    {#if heading}<Eyebrow icon={ListMusic}>Setlist</Eyebrow>{/if}
    {#if store.canEdit}
      <span class="add">
        <IconButton icon={Plus} label="Add song" size={14} onclick={() => store.createSong()} />
      </span>
    {/if}
  </div>
  <ul class="list">
    {#each rows as row (row.id)}
      <li>
        <EditableRow
          label={row.name}
          secondary={`${row.sectionCount} ${row.sectionCount === 1 ? 'section' : 'sections'}`}
          active={store.activeSongId === row.id}
          renameLabel={row.origin === 'reference' ? 'Rename library song' : 'Rename song'}
          onclick={() => store.setActiveSong(row.id)}
          onCommit={(name) => commitRename(row, name)}
          actions={rowActions(row)}
        >
          {#snippet trailing()}
            {#if row.origin === 'reference'}
              <StatusPill tone="muted" label="Library" title="References a Song Library song — edits propagate" />
            {/if}
          {/snippet}
        </EditableRow>
      </li>
    {/each}
  </ul>
</div>

<style>
  .songrail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* keep the add control flush-right whether or not the Eyebrow heading is shown */
  .add {
    margin-inline-start: auto;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: auto;
  }
</style>
