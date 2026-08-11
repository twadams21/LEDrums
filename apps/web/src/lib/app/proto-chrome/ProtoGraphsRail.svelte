<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). The Graphs list as a LEFT pane for the
     Trigger tab — a vertical re-house of GraphsDock's cards (real store wiring:
     open/select/new graph, thumbs, hotkey badges). Section switching lives in the
     sticky sections bar, so this pane is just the active section's graphs. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { describeTriggerSource } from '../trigger-source-label';
  import { graphThumb } from '../views/graph-thumb';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Plus from '@lucide/svelte/icons/plus';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const section = $derived(store.activeSection);
  const graphs = $derived(section?.graphs ?? []);

  function hotkey(index: number): string | null {
    if (index < 9) return String(index + 1);
    if (index === 9) return '0';
    return null;
  }

  function openGraph(key: string): void {
    if (!section) return;
    store.selectGraphInSection(section.id, key);
    shell.clearSelection();
  }

  function newGraph(): void {
    if (!section) return;
    const key = store.createGraph();
    store.addGraphToSection(section.id, key);
    shell.clearSelection();
  }

  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }
</script>

<aside class="grail">
  <PanelHeader icon={Workflow} title="Graphs" />
  <div class="cards">
    {#if !section}
      <p class="none">No section is active — pick one in the sections bar.</p>
    {:else}
      {#each graphs as key, i (key)}
        {@const g = store.resolvedView.graphs[key]}
        {@const hk = hotkey(i)}
        {@const thumb = g ? graphThumb(g) : null}
        <button
          type="button"
          class="gcard"
          class:sel={store.selectedPadKey === key}
          onclick={() => openGraph(key)}
          title="Open {store.graphLabel(key)}"
        >
          {#if hk}<span class="khot">{hk}</span>{/if}
          {#if thumb}
            <svg class="gthumb" viewBox="0 0 172 104" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              {#each thumb.paths as d, pi (pi)}<path {d} />{/each}
              {#each thumb.dots as p, di (di)}<circle cx={p.x} cy={p.y} r="3.5" />{/each}
            </svg>
          {/if}
          <span class="gmeta">
            <span class="gn">{store.graphLabel(key)}</span>
            <span class="gt">{sourceSub(key)}</span>
          </span>
        </button>
      {/each}
      {#if store.canEdit}
        <button type="button" class="newcard" onclick={newGraph}>
          <Plus size={15} aria-hidden="true" />
          New graph
        </button>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .grail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }
  .gcard {
    position: relative;
    flex: none;
    height: 84px;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    /* instant hover on graph chrome (locked prefs) */
  }
  .gcard:hover {
    border-color: var(--border-strong);
  }
  .gcard.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .khot {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-2);
    background: var(--surface-3);
    box-shadow: 0 2px 0 var(--border);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .gcard.sel .khot {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  .gthumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.5;
    pointer-events: none;
  }
  .gthumb path {
    fill: none;
    stroke: var(--border);
    stroke-width: 1.4;
  }
  .gthumb circle {
    fill: var(--accent-dim);
  }
  .gmeta {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .gn {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gt {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .newcard {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 40px;
    background: transparent;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .newcard:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  .none {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
