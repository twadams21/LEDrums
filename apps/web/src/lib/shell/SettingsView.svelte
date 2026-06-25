<script lang="ts">
  /* Settings — the rig-config view. Sub-tabs:
       Patch  → node/patch signal-flow canvas (RoutingView)
       Output → device + IP (OutputConfig)
       Kit    → input map & geometry (MapView) */
  import RoutingView from '../views/RoutingView.svelte';
  import OutputConfig from '../panels/OutputConfig.svelte';
  import MapView from '../views/MapView.svelte';
  import Icon from './Icon.svelte';

  type Tab = 'patch' | 'output' | 'kit';
  let tab = $state<Tab>('patch');

  const tabs: Array<{ id: Tab; label: string; icon: string; hint: string }> = [
    { id: 'patch', label: 'Patch', icon: 'patch', hint: 'Signal-flow node canvas' },
    { id: 'output', label: 'Output', icon: 'output', hint: 'Controller, protocol & IP' },
    { id: 'kit', label: 'Kit', icon: 'kit', hint: 'Input map & geometry' },
  ];
</script>

<section class="settings">
  <nav class="tabs" aria-label="Settings section">
    {#each tabs as t (t.id)}
      <button class="tab" class:active={tab === t.id} aria-pressed={tab === t.id} onclick={() => (tab = t.id)}>
        <Icon name={t.icon} size={15} />
        <span class="t-label">{t.label}</span>
        <span class="t-hint">{t.hint}</span>
      </button>
    {/each}
  </nav>

  <div class="tab-body">
    {#if tab === 'patch'}
      <RoutingView />
    {:else if tab === 'output'}
      <div class="centered"><div class="card"><OutputConfig /></div></div>
    {:else}
      <MapView />
    {/if}
  </div>
</section>

<style>
  .settings {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    height: 100%;
    min-height: 0;
  }
  .tabs {
    display: flex;
    gap: var(--space-2);
  }
  .tab {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    column-gap: var(--space-2);
    align-items: center;
    text-align: left;
    padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .tab :global(svg) {
    grid-row: 1 / 3;
    color: var(--text-faint);
  }
  .t-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
  }
  .t-hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .tab.active {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .tab.active :global(svg) {
    color: var(--accent);
  }
  .tab.active .t-label {
    color: var(--ink);
  }

  .tab-body {
    min-height: 0;
    min-width: 0;
  }
  .centered {
    height: 100%;
    overflow: auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: var(--space-2);
  }
  .card {
    width: min(640px, 100%);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    padding: var(--space-4);
  }
</style>
