<script lang="ts">
  /* Sections / Setlist view. Target (later milestone): a grid of reusable,
     layerable GRAPHS — sections on X, drums on Y, 2–3 graph slots per drum, the
     same graph reused across sections. The store's model is still per-section
     "looks" (base/trigger/effect), so this milestone shows the real section set +
     their looks and wires recall; the layerable-graph slot grid lands with the
     core-model slice. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';

  let { store }: { store: TriggerLab; shell: ShellStore } = $props();

  const LAYERS = [
    { id: 'base', name: 'Base' },
    { id: 'trigger', name: 'Trigger' },
    { id: 'effect', name: 'Effect' },
  ] as const;

  function lookName(id: string | null | undefined): string {
    if (!id) return '—';
    return store.effects.find((e) => e.id === id)?.name ?? id;
  }
</script>

<div class="sections-view">
  <header class="head">
    <Eyebrow icon={LayoutGrid}>Setlist · sections</Eyebrow>
    <span class="hint">click a section to recall it · layerable per-drum graph slots arrive with the core-model slice</span>
  </header>

  <div class="grid" style="--cols:{store.sections.length}">
    <div class="corner"></div>
    {#each store.sections as s (s.id)}
      <button
        class="colh"
        class:active={store.activeSectionId === s.id}
        onclick={() => store.recall(s.id)}
      >
        {s.name}
      </button>
    {/each}

    {#each LAYERS as layer (layer.id)}
      <div class="rowh">{layer.name}</div>
      {#each store.sections as s (s.id)}
        {@const look = s.looks[layer.id]}
        <div class="cell" class:use={!!look} class:active={store.activeSectionId === s.id}>
          {lookName(look)}
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .sections-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .grid {
    display: grid;
    grid-template-columns: 88px repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-2);
    align-content: start;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: auto;
    min-height: 0;
  }
  .corner {
    background: transparent;
  }
  .colh {
    padding: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
  }
  .colh:hover {
    color: var(--ink);
    border-color: var(--border-strong);
  }
  .colh.active {
    color: var(--ink);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    background: var(--accent-soft);
  }
  .rowh {
    display: flex;
    align-items: center;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    background: var(--surface-inset);
  }
  .cell.use {
    color: var(--accent);
    border-style: solid;
    border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
  }
  .cell.active {
    background: var(--surface-2);
  }
</style>
