<script lang="ts">
  /* Left-rail song list. Songs are the top of the setlist hierarchy; selecting one
     makes its sections the columns of the Sections view. Shared by Author + Perform.
     (Adding/removing songs + persistence is a later slice — see the redesign plan.) */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';

  let { store, heading = true }: { store: TriggerLab; heading?: boolean } = $props();
</script>

<div class="songrail">
  {#if heading}<Eyebrow icon={ListMusic}>Songs</Eyebrow>{/if}
  <ul class="list">
    {#each store.songs as song (song.id)}
      <li>
        <button
          class="item"
          class:active={store.activeSongId === song.id}
          aria-pressed={store.activeSongId === song.id}
          onclick={() => store.setActiveSong(song.id)}
        >
          <span class="name">{song.name}</span>
          <span class="count">{song.sections.length}</span>
        </button>
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
</style>
