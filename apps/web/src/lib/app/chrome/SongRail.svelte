<script lang="ts">
  /* Left-rail song list. Songs are the top of the setlist hierarchy; selecting one
     makes its sections the columns of the Sections view. Shared by Author + Perform.
     A performer can add a song (+ in the header), and right-click a row to Rename
     (inline), Duplicate, or Delete it — all persisted via the store's autosave. */
  import type { Attachment } from 'svelte/attachments';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, heading = true }: { store: TriggerLab; heading?: boolean } = $props();

  // The song being renamed in place (or null). The committed value flows straight to
  // store.renameSong on Enter / blur; Escape cancels. The store guards empty/unknown.
  let editingId = $state<string | null>(null);

  function startRename(id: string): void {
    // Defer past the context-menu's own close + focus-return, so the input we mount
    // keeps focus instead of the menu yanking it back to the (now-replaced) trigger.
    requestAnimationFrame(() => (editingId = id));
  }
  function commitRename(id: string, value: string): void {
    if (editingId !== id) return; // already committed/cancelled (e.g. a trailing blur)
    editingId = null;
    store.renameSong(id, value);
  }
  function cancelRename(): void {
    editingId = null;
  }

  /** The right-click verbs for one song row: Rename · Duplicate · Delete. */
  function rowActions(id: string): ContextMenuAction[] {
    return [
      { label: 'Rename', icon: Pencil, onSelect: () => startRename(id) },
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

  /** Focus + select-all an inline rename field the moment it mounts. */
  const focusRename: Attachment<HTMLInputElement> = (node) => {
    node.focus();
    node.select();
  };
</script>

<div class="songrail">
  <div class="head">
    {#if heading}<Eyebrow icon={ListMusic}>Songs</Eyebrow>{/if}
    <span class="add">
      <IconButton icon={Plus} label="Add song" size={14} onclick={() => store.createSong()} />
    </span>
  </div>
  <ul class="list">
    {#each store.songs as song (song.id)}
      <li>
        {#if editingId === song.id}
          <input
            class="rename"
            type="text"
            value={song.name}
            aria-label="Rename song"
            {@attach focusRename}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(song.id, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onblur={(e) => commitRename(song.id, e.currentTarget.value)}
          />
        {:else}
          <ContextMenu actions={rowActions(song.id)}>
            <button
              class="item"
              class:active={store.activeSongId === song.id}
              aria-pressed={store.activeSongId === song.id}
              onclick={() => store.setActiveSong(song.id)}
              ondblclick={() => startRename(song.id)}
            >
              <span class="name">{song.name}</span>
              <span class="count">{song.sections.length}</span>
            </button>
          </ContextMenu>
        {/if}
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
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: left;
  }
  .item:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .item.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  /* inline rename — fills the row, reads as the active row being edited */
  .rename {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid color-mix(in oklch, var(--accent) 55%, transparent);
    border-radius: var(--radius-2);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
  }
  .rename:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
