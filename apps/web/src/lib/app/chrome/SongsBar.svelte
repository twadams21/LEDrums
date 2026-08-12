<script lang="ts">
  /* Setlist songs bar (tabbed chrome row 2): the active show's setlist as a chip
     row — local songs and resolved library references (showSongRows), the active
     song raised, plus an add-song affordance for editors. Selecting a chip
     re-points the whole shell (sections bar, workspace) at that song. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { showSongRows } from '../views/objects-view';
  import IconButton from '../../ui/IconButton.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Plus from '@lucide/svelte/icons/plus';

  let { store }: { store: TriggerLab } = $props();

  const songRows = $derived(showSongRows(store.songs, store.resolvedSongs));
</script>

<div class="bar" role="navigation" aria-label="Setlist songs">
  <span class="rowlabel"><ListMusic size={13} aria-hidden="true" /> Setlist</span>
  <div class="chips">
    {#if songRows.length === 0}
      <span class="none">No songs in this show</span>
    {/if}
    {#each songRows as row (row.id)}
      <button
        type="button"
        class="chip"
        class:on={store.activeSongId === row.id}
        aria-current={store.activeSongId === row.id ? 'true' : undefined}
        onclick={() => store.setActiveSong(row.id)}
        title={row.origin === 'reference' ? `${row.name} (Library)` : row.name}
      >
        {row.name}<span class="cnt">{row.sectionCount}</span>
      </button>
    {/each}
    {#if store.canEdit}
      <IconButton icon={Plus} label="Add song" size={13} onclick={() => store.createSong()} />
    {/if}
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
  .none {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
