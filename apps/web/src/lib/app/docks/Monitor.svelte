<script lang="ts">
  /* Monitor / Log: input, output and graph/effect events for debugging routing. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Select from '../../ui/Select.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  let { store, variant = 'dock' }: { store: TriggerLab; variant?: 'dock' | 'workspace' } = $props();

  const TYPE_OPTS = [
    { value: 'all', label: 'All types' },
    { value: 'system', label: 'System' },
    { value: 'input', label: 'Input' },
    { value: 'graph', label: 'Graph' },
    { value: 'effect', label: 'Effect' },
    { value: 'output', label: 'Output' },
    { value: 'persistence', label: 'Persistence' },
    { value: 'error', label: 'Error' },
  ];

  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false });
</script>

<div class={['monitor', variant]}>
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
      placeholder="Search"
      aria-label="Monitor search filter"
    />
    {#if variant === 'workspace'}
      <input
        value={store.monitorSourceFilter}
        oninput={(e) => store.setMonitorSourceFilter(e.currentTarget.value)}
        placeholder="Source"
        aria-label="Monitor source filter"
      />
      <input
        value={store.monitorDestinationFilter}
        oninput={(e) => store.setMonitorDestinationFilter(e.currentTarget.value)}
        placeholder="Destination"
        aria-label="Monitor destination filter"
      />
      <button type="button" class="icon" title="Reset filters" onclick={() => store.resetMonitorFilters()}>
        <RotateCcw size={14} aria-hidden="true" />
      </button>
    {/if}
    <button type="button" class="icon" title="Clear monitor" onclick={() => store.clearMonitor()}>
      <Trash2 size={14} aria-hidden="true" />
    </button>
  </div>

  {#if variant === 'workspace'}
    <div class="summary" aria-label="Monitor summary">
      <span>{store.visibleMonitorEvents.length} shown</span>
      <span>{store.monitorEvents.length} retained</span>
    </div>
  {/if}

  {#if store.visibleMonitorEvents.length === 0}
    <p class="empty">No matching monitor events yet.</p>
  {:else}
    <div class="log">
      {#each store.visibleMonitorEvents as e (e.id)}
        <div class={['entry', `type-${e.type}`]}>
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
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
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
  .workspace .tools {
    grid-template-columns: 150px minmax(180px, 1fr) minmax(120px, 0.5fr) minmax(140px, 0.5fr) 32px 32px;
    padding: var(--space-3);
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
  .summary {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3) 0;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
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
    padding: 0 0 var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border-faint);
    border-left: 2px solid var(--border);
  }
  .workspace .entry {
    display: grid;
    grid-template-columns: minmax(250px, 0.4fr) minmax(240px, 1fr);
    column-gap: var(--space-4);
    row-gap: 2px;
  }
  .workspace .detail {
    grid-column: 2;
  }
  .type-system {
    border-left-color: var(--text-faint);
  }
  .type-input {
    border-left-color: var(--accent);
  }
  .type-graph,
  .type-effect {
    border-left-color: var(--warn);
  }
  .type-output {
    border-left-color: var(--ok);
  }
  .type-persistence {
    border-left-color: var(--info);
  }
  .type-error {
    border-left-color: oklch(0.68 0.18 25);
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
  @media (max-width: 980px) {
    .workspace .tools {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px 32px;
    }
    .workspace .tools input[aria-label='Monitor source filter'],
    .workspace .tools input[aria-label='Monitor destination filter'] {
      grid-column: span 2;
    }
    .workspace .entry {
      display: flex;
    }
  }
</style>
