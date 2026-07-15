<script lang="ts">
  /* Graphs dock — the bottom bar of the Trigger view (approved wave-3 shell). The
     active song's sections as tabs, and the active section's graphs as cards: each
     card wears its hotkey badge (keys 1–9 and 0 fire graphs 1–10; ←/→ switch
     sections — handled globally in App.svelte), a mini-map of the real graph, the
     graph name and its trigger source. Clicking a card opens it on the canvas;
     firing flashes it. Replaces the old left graph-list rail. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { describeTriggerSource } from '../trigger-source-label';
  import { graphThumb } from './graph-thumb';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Plus from '@lucide/svelte/icons/plus';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const song = $derived(store.activeSong);
  const section = $derived(store.activeSection);
  const graphs = $derived(section?.graphs ?? []);

  /** Hotkey label for the n-th card: 1–9, then 0 for the tenth; none beyond. */
  function hotkey(index: number): string | null {
    if (index < 9) return String(index + 1);
    if (index === 9) return '0';
    return null;
  }

  function openGraph(key: string): void {
    if (!section) return;
    store.selectGraphInSection(section.id, key);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
  /** Author a new graph, add it to the active section, and open it for editing. */
  function newGraph(): void {
    if (!section) return;
    const key = store.createGraph();
    store.addGraphToSection(section.id, key);
    shell.clearSelection();
  }
  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }

  // Fire flash: fireSectionGraph stamps store.lastSectionFire; hold it briefly so the
  // fired card wears a one-shot overlay ({#key seq} restarts the animation on re-fire).
  let flash = $state<{ key: string; seq: number } | null>(null);
  $effect(() => {
    const f = store.lastSectionFire;
    if (!f) return;
    flash = f;
    const t = window.setTimeout(() => (flash = null), 520);
    return () => window.clearTimeout(t);
  });
</script>

<section class="graphbar">
  <PanelHeader icon={Workflow} title="Graphs">
    <nav class="sectabs" aria-label="Sections">
      {#each song?.sections ?? [] as sec (sec.id)}
        <button
          type="button"
          class="sectab"
          class:on={sec.id === store.activeSectionId}
          onclick={() => store.setActiveSection(sec.id)}
        >
          {sec.name}<span class="cnt">{sec.graphs.length}</span>
        </button>
      {/each}
    </nav>
    <span class="hint" aria-hidden="true">
      <kbd>1</kbd>–<kbd>9</kbd> fire · <kbd>←</kbd><kbd>→</kbd> section
    </span>
  </PanelHeader>

  <div class="cards">
    {#if !section}
      <p class="none">No section is active — pick one in the Sections view.</p>
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
            <svg class="gthumb" viewBox="0 0 172 104" aria-hidden="true">
              {#each thumb.paths as d, pi (pi)}<path {d} />{/each}
              {#each thumb.dots as p, di (di)}<circle cx={p.x} cy={p.y} r="3.5" />{/each}
            </svg>
          {/if}
          <span class="gmeta">
            <span class="gn">{store.graphLabel(key)}</span>
            <span class="gt">{sourceSub(key)}</span>
          </span>
          {#if flash?.key === key}
            {#key flash.seq}<span class="fireburst" aria-hidden="true"></span>{/key}
          {/if}
        </button>
      {/each}
      {#if store.canEdit}
        <button type="button" class="newcard" onclick={newGraph}>
          <Plus size={16} aria-hidden="true" />
          New graph
        </button>
      {/if}
    {/if}
  </div>
</section>

<style>
  .graphbar {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .sectabs {
    display: flex;
    align-items: center;
    gap: var(--space-0_5);
    min-width: 0;
    overflow-x: auto;
  }
  .sectab {
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
  }
  .sectab:hover {
    color: var(--text);
  }
  .sectab.on {
    background: var(--surface-3);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .cnt {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: var(--space-3);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: none;
    letter-spacing: normal;
    white-space: nowrap;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--surface-2);
    box-shadow: 0 1px 0 var(--border);
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-muted);
  }
  .cards {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-2) var(--space-3);
    overflow-x: auto;
  }
  .gcard {
    position: relative;
    flex: none;
    width: 172px;
    height: 116px;
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
    left: 8px;
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
    opacity: 0.55;
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
    font-size: var(--text-base);
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
  .fireburst {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    animation: fireburst 500ms var(--ease-out-quart) forwards;
  }
  @keyframes fireburst {
    0% {
      box-shadow:
        inset 0 0 0 2px var(--accent),
        0 0 20px var(--accent-soft);
      opacity: 1;
    }
    100% {
      box-shadow:
        inset 0 0 0 2px var(--accent),
        0 0 20px var(--accent-soft);
      opacity: 0;
    }
  }
  .newcard {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    width: 172px;
    height: 116px;
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
  .newcard:active {
    scale: 0.98;
  }
  .none {
    margin: auto 0;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .fireburst {
      animation-duration: 0ms;
    }
    .newcard:active {
      scale: 1;
    }
  }
</style>
