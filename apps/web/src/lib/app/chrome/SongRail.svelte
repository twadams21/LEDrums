<script lang="ts">
  /* Left-rail song list. Songs are the top of the setlist hierarchy; selecting one
     makes its sections the columns of the Sections view. Shared by Author + Perform.
     A performer can add a song (+ in the header), and right-click a row to Rename
     (inline), Duplicate, or Delete it — all persisted via the store's autosave.

     Each row is a shared `lib/ui/EditableRow` (ListItem + inline CommitInput rename +
     right-click ContextMenu); the bespoke `<input>`+rAF rename and `.item` styling are
     gone — the rename/select/verb wiring lives in the primitive. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, heading = true }: { store: TriggerLab; heading?: boolean } = $props();

  /** The right-click verbs for one song row, appended after EditableRow's built-in Rename. */
  function rowActions(id: string): ContextMenuAction[] {
    return [
      { label: 'Duplicate', icon: Copy, onSelect: () => store.duplicateSong(id) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        disabled: store.songs.length <= 1, // the app always keeps one song
        onSelect: () => store.removeSong(id),
      },
    ];
  }
</script>

<div class="songrail">
  <div class="head">
    {#if heading}<Eyebrow icon={ListMusic}>Songs</Eyebrow>{/if}
    {#if store.canEdit}
      <span class="add">
        <IconButton icon={Plus} label="Add song" size={14} onclick={() => store.createSong()} />
      </span>
    {/if}
  </div>
  <ul class="list">
    {#each store.songs as song (song.id)}
      <li>
        <EditableRow
          label={song.name}
          secondary={`${song.sections.length} ${song.sections.length === 1 ? 'section' : 'sections'}`}
          active={store.activeSongId === song.id}
          renameLabel="Rename song"
          onclick={() => store.setActiveSong(song.id)}
          onCommit={(name) => store.renameSong(song.id, name)}
          actions={rowActions(song.id)}
        />
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
