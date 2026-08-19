<script lang="ts">
  /* Setlist songs bar (tabbed chrome row 2): the active show's setlist as a chip
     row — local songs and resolved library references (showSongRows), the active
     song raised, plus an add-song affordance for editors. Selecting a chip
     re-points the whole shell (sections bar, workspace) at that song.

     Per-chip verbs (mined from the retired SongRail): right-click a chip to
     Rename (inline CommitInput; double-click too), Duplicate, or Delete a local
     song, or Detach copy / Remove from show for a library reference. A reference
     wears a visible LibraryBig badge; renaming one routes to the canonical
     library copy (propagates). Chips stay chips — no row chrome. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { showSongRows, type ShowSongRow } from '../views/objects-view';
  import { VIEWING_REASON } from './edit-gate';
  import IconButton from '../../ui/IconButton.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import LibraryBig from '@lucide/svelte/icons/library-big';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Copy from '@lucide/svelte/icons/copy';
  import Unlink from '@lucide/svelte/icons/unlink';
  import X from '@lucide/svelte/icons/x';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store }: { store: TriggerLab } = $props();

  const songRows = $derived(showSongRows(store.songs, store.resolvedSongs));
  // The last-song guard counts LOCAL songs only — removing a reference drops the
  // ref, never the local setlist (SongRail's rule, unchanged).
  const canDeleteLocal = $derived(store.songs.length > 1);

  /** The chip being renamed in place, or null. */
  let editingId = $state<string | null>(null);

  // Defer past the context-menu's own close + focus-return, so the input we mount
  // keeps focus instead of the menu yanking it back (mirrors EditableRow).
  function startRename(id: string): void {
    requestAnimationFrame(() => (editingId = id));
  }

  function detach(id: string): void {
    const localId = store.detachSongReference(id);
    if (localId) store.setActiveSong(localId);
  }

  /** Rename routes to the canonical library copy for a reference (propagates), else the local song. */
  function commitRename(row: ShowSongRow, name: string): void {
    editingId = null;
    if (row.origin === 'reference') store.renameLibrarySong(row.id, name);
    else store.renameSong(row.id, name);
  }

  /** The right-click verbs for one chip, by origin — local song CRUD vs library-reference verbs. */
  function rowActions(row: ShowSongRow): ContextMenuAction[] {
    const rename: ContextMenuAction = { label: 'Rename', icon: Pencil, onSelect: () => startRename(row.id) };
    if (row.origin === 'reference') {
      return [
        rename,
        { label: 'Detach copy', icon: Unlink, onSelect: () => detach(row.id) },
        { label: 'Remove from show', icon: X, onSelect: () => store.removeSongReference(row.id) },
      ];
    }
    return [
      rename,
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
</script>

<div class="bar" role="navigation" aria-label="Setlist songs">
  <span class="rowlabel"><ListMusic size={13} aria-hidden="true" /> Setlist</span>
  <div class="chips">
    {#if songRows.length === 0}
      <span class="none">No songs in this show</span>
    {/if}
    {#each songRows as row (row.id)}
      {#if editingId === row.id}
        <span class="chip-edit">
          <CommitInput
            value={row.name}
            ariaLabel={row.origin === 'reference' ? 'Rename library song' : 'Rename song'}
            onCommit={(name) => commitRename(row, name)}
            onCancel={() => (editingId = null)}
          />
        </span>
      {:else}
        <ContextMenu actions={rowActions(row)} disabled={!store.canEdit}>
          <button
            type="button"
            class="chip"
            class:on={store.activeSongId === row.id}
            aria-current={store.activeSongId === row.id ? 'true' : undefined}
            onclick={() => store.setActiveSong(row.id)}
            ondblclick={() => store.canEdit && startRename(row.id)}
            title={row.origin === 'reference' ? `${row.name} (Library)` : row.name}
          >
            {row.name}{#if row.origin === 'reference'}<span
                class="ref"
                role="img"
                aria-label="Library reference"
                title="References a Song Library song — edits propagate"><LibraryBig size={11} aria-hidden="true" /></span
              >{/if}<span class="cnt">{row.sectionCount}</span>
          </button>
        </ContextMenu>
      {/if}
    {/each}
    <!-- Visible-but-disabled for a viewer (edit-gate.ts): a vanishing `+` reads as a bug. -->
    <IconButton
      icon={Plus}
      label="Add song"
      size={13}
      disabled={!store.canEdit}
      disabledReason={store.canEdit ? undefined : VIEWING_REASON}
      onclick={() => store.createSong()}
    />
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .rowlabel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .chips {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 4px var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
    transition-property: color, background-color;
    transition-duration: var(--dur-150);
  }
  .chip:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .chip.on {
    background: var(--surface-3);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .cnt {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  /* Visible library-reference badge — icon+tooltip, aligned to the chip text. */
  .ref {
    display: inline-flex;
    align-self: center;
    color: var(--text-faint);
  }
  /* Keep the bar height stable while a chip swaps to its rename input. */
  .chip-edit {
    display: inline-flex;
    flex: none;
    width: 140px;
  }
  .none {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
