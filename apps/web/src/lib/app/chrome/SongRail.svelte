<script lang="ts">
  /* Left-rail section list — the recallable scenes ("looks"). Clicking recalls a
     section (timed morph on the engine). This is the rail's "Songs" slot in the
     wireframe; a Song → sections hierarchy is a later milestone, so today it lists
     the flat section set the engine actually knows. Shared by Author + Perform. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';

  let { store, heading = true }: { store: TriggerLab; heading?: boolean } = $props();
</script>

<div class="songrail">
  {#if heading}<Eyebrow icon={ListMusic}>Sections</Eyebrow>{/if}
  <ul class="list">
    {#each store.sections as s (s.id)}
      <li>
        <button
          class="item"
          class:active={store.activeSectionId === s.id}
          aria-pressed={store.activeSectionId === s.id}
          onclick={() => store.recall(s.id)}
        >
          <span class="name">{s.name}</span>
          {#if store.activeSectionId === s.id}<span class="now">live</span>{/if}
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
  .now {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
  }
</style>
