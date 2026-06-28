<script lang="ts">
  /* Monitor / Log — input hits and how each resolved through the trigger graph.
     Lives behind the right-dock's Monitor tab (hidden until needed). Reads the
     engine store's rolling resolution log. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';

  let { store }: { store: TriggerLab } = $props();
</script>

<div class="monitor">
  {#if store.log.length === 0}
    <p class="empty">No hits yet — fire a pad or play a graph to see how it resolves.</p>
  {:else}
    <div class="log">
      {#each store.log as e, i (i + '-' + e.t)}
        <div class="entry">
          <span class="pad">{e.pad}</span>
          {#each e.resolved as r (r)}<span class="line">{r}</span>{/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .monitor {
    min-height: 0;
    height: 100%;
    overflow: auto;
  }
  .empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .log {
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-family: var(--font-mono);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-faint);
  }
  .pad {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .line {
    font-size: var(--text-xs);
    color: var(--text);
  }
</style>
