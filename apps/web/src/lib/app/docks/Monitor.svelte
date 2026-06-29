<script lang="ts">
  /* Monitor / Log: input, output and graph/effect events for debugging routing. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Select from '../../ui/Select.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store }: { store: TriggerLab } = $props();

  const TYPE_OPTS = [
    { value: 'all', label: 'All types' },
    { value: 'input', label: 'Input' },
    { value: 'output', label: 'Output' },
    { value: 'effect', label: 'Effect' },
    { value: 'graph', label: 'Graph' },
    { value: 'system', label: 'System' },
  ];

  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false });
</script>

<div class="monitor">
  <div class="tools">
    <Select
      value={store.monitorTypeFilter}
      options={TYPE_OPTS}
      onChange={(v) => store.setMonitorTypeFilter(v as typeof store.monitorTypeFilter)}
      ariaLabel="Monitor type filter"
    />
    <input
      value={store.monitorTextFilter}
      oninput={(e) => store.setMonitorTextFilter(e.currentTarget.value)}
      placeholder="source, destination, note..."
      aria-label="Monitor text filter"
    />
    <button type="button" class="icon" title="Clear monitor" onclick={() => store.clearMonitor()}>
      <Trash2 size={14} aria-hidden="true" />
    </button>
  </div>

  {#if store.visibleMonitorEvents.length === 0}
    <p class="empty">No matching monitor events yet.</p>
  {:else}
    <div class="log">
      {#each store.visibleMonitorEvents as e (e.id)}
        <div class="entry">
          <span class="meta">{fmtTime(e.time)} - {e.type} - {e.direction} - {e.source}{e.destination ? ` -> ${e.destination}` : ''}</span>
          <span class="line">{e.label}</span>
          {#if e.detail}<span class="detail">{e.detail}</span>{/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if store.log.length > 0}
    <div class="section-title">Resolution log</div>
    <div class="log">
      {#each store.log as e, i (i + '-' + e.t)}
        <div class="entry">
          <span class="meta">{e.pad}</span>
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
  .tools {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) 30px;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--border-faint);
  }
  .tools :global(.sel),
  input {
    width: 100%;
  }
  input {
    height: 29px;
    min-width: 0;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text);
    font-size: var(--text-xs);
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 29px;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
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
  .meta {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .line {
    font-size: var(--text-xs);
    color: var(--text);
  }
  .detail {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .section-title {
    padding: var(--space-2) var(--space-3) 0;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
</style>
