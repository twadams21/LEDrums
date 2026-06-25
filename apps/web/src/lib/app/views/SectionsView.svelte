<script lang="ts">
  /* Sections / Setlist — the real model: a grid of reusable, layerable GRAPHS.
     Columns = the active song's sections; rows = drums, each with up to
     SLOTS_PER_DRUM graph slots (L1..L3). A slot references a trigger graph by key,
     so the same graph can appear in many sections (reuse), and stacking a second
     graph in another slot layers it (layer routing lives in the graph's buses).
     Clicking an empty slot opens the graph picker; a filled slot can be edited
     (jumps to the Trigger Graph view) or cleared. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { SLOTS_PER_DRUM, slotsFor, isReused } from '../setlist';
  import Drawer from '../../ui/Drawer.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Workflow from '@lucide/svelte/icons/workflow';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const song = $derived(store.activeSong);
  const sections = $derived(song?.sections ?? []);
  const slotRows = Array.from({ length: SLOTS_PER_DRUM }, (_, i) => i);

  // graph picker: the slot awaiting a graph (or null when closed)
  let pending = $state<{ sectionId: string; drumId: string; slot: number } | null>(null);

  function place(graphKey: string): void {
    if (!pending) return;
    store.assignSlot(pending.sectionId, pending.drumId, pending.slot, graphKey);
    pending = null;
  }
  function editSlot(graphKey: string): void {
    store.editGraph(graphKey);
    shell.setView('trigger');
  }
  /** Author a fresh graph, drop it into the pending slot, and jump to edit it. */
  function createAndPlace(): void {
    if (!pending) return;
    const key = store.createGraph();
    store.assignSlot(pending.sectionId, pending.drumId, pending.slot, key);
    pending = null;
    shell.setView('trigger'); // createGraph selected it — land on the canvas to edit
  }
</script>

<div class="sections-view">
  <header class="head">
    <div class="title">
      <Eyebrow icon={LayoutGrid}>Setlist</Eyebrow>
      <h2>{song?.name ?? 'No song'}</h2>
    </div>
    <button class="addsection" type="button" onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}>
      <Plus size={14} aria-hidden="true" /> Section
    </button>
  </header>

  {#if song}
    <div class="gridwrap">
      <div class="grid" style="--cols:{sections.length}">
        <!-- header row -->
        <div class="corner"></div>
        <div class="corner"></div>
        {#each sections as sec (sec.id)}
          <button
            class="colh"
            class:active={store.arrangeSectionId === sec.id}
            onclick={() => store.setArrangeSection(sec.id)}
          >
            {sec.name}
          </button>
        {/each}

        <!-- one block of SLOTS_PER_DRUM rows per drum -->
        {#each store.drums as drum (drum.id)}
          {#each slotRows as slot (slot)}
            {#if slot === 0}
              <div class="drumh" style="grid-row: span {SLOTS_PER_DRUM}">{drum.label}</div>
            {/if}
            <div class="sloth">L{slot + 1}</div>
            {#each sections as sec (sec.id)}
              {@const key = slotsFor(sec, drum.id)[slot] ?? null}
              {#if key}
                {@const reused = isReused(song, key)}
                <div class="cell filled" class:reused class:dim={store.arrangeSectionId !== sec.id}>
                  <button class="cell-main" title="Edit {store.graphLabel(key)}" onclick={() => editSlot(key)}>
                    <Workflow size={12} aria-hidden="true" />
                    <span class="cell-label">{store.graphLabel(key)}</span>
                    {#if reused}<span class="reuse-dot" title="Reused in another section" aria-hidden="true"></span>{/if}
                  </button>
                  <div class="cell-actions">
                    <IconButton icon={Pencil} label="Edit graph" size={12} onclick={() => editSlot(key)} />
                    <IconButton icon={X} label="Clear slot" size={12} onclick={() => store.clearSlot(sec.id, drum.id, slot)} />
                  </div>
                </div>
              {:else}
                <button
                  class="cell add"
                  class:dim={store.arrangeSectionId !== sec.id}
                  title="Place a graph"
                  onclick={() => (pending = { sectionId: sec.id, drumId: drum.id, slot })}
                >
                  <Plus size={13} aria-hidden="true" />
                </button>
              {/if}
            {/each}
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>

<Drawer open={!!pending} onClose={() => (pending = null)} title="Place a graph" side="right" width="320px">
  {#if pending}
    <p class="picker-ctx">
      {store.drums.find((d) => d.id === pending!.drumId)?.label} · L{pending.slot + 1} ·
      {sections.find((s) => s.id === pending!.sectionId)?.name}
    </p>
    <div class="picker-list">
      <button class="picker-item new" onclick={createAndPlace}>
        <Plus size={14} aria-hidden="true" />
        <span>New graph</span>
        <span class="picker-tag">empty</span>
      </button>
      {#each store.graphLibrary as g (g.key)}
        <button class="picker-item" onclick={() => place(g.key)}>
          <Workflow size={14} aria-hidden="true" />
          <span>{g.label}</span>
          {#if isReused(song!, g.key) || (song && song.sections.some((s) => slotsFor(s, pending!.drumId).includes(g.key)))}
            <span class="picker-tag">in use</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</Drawer>

<style>
  .sections-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
    -webkit-font-smoothing: antialiased;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .addsection {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
  .gridwrap {
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .grid {
    display: grid;
    grid-template-columns: 64px 30px repeat(var(--cols), minmax(132px, 1fr));
    gap: var(--space-1);
    align-content: start;
  }
  .corner {
    background: transparent;
  }
  .colh {
    position: sticky;
    top: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition: color 120ms ease, border-color 120ms ease;
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
  .drumh {
    display: flex;
    align-items: center;
    padding: 0 var(--space-1);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
  }
  .sloth {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .cell {
    display: flex;
    align-items: center;
    min-height: 34px;
    border-radius: var(--radius-2);
    transition: border-color 120ms ease, background-color 120ms ease, opacity 120ms ease;
  }
  .cell.dim {
    opacity: 0.62;
  }
  .cell.add {
    justify-content: center;
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px dashed var(--border-strong);
  }
  .cell.add:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    opacity: 1;
  }
  .cell.add:active {
    scale: 0.97;
  }
  .cell.filled {
    justify-content: space-between;
    gap: var(--space-1);
    padding: 2px 4px 2px 2px;
    background: var(--surface-2);
    border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));
  }
  .cell.filled.reused {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
  }
  .cell-main {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    padding: 4px var(--space-1);
    background: transparent;
    border: none;
    text-align: left;
    color: var(--accent);
  }
  .cell-main :global(svg) {
    flex: none;
    opacity: 0.85;
  }
  .cell-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--ink);
  }
  .reuse-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .cell-actions {
    display: none;
    align-items: center;
    gap: 1px;
    flex: none;
  }
  .cell.filled:hover .cell-actions {
    display: inline-flex;
  }
  /* picker drawer */
  .picker-ctx {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .picker-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .picker-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    text-align: left;
    color: var(--text);
  }
  .picker-item:hover {
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    color: var(--ink);
  }
  .picker-item:active {
    scale: 0.98;
  }
  .picker-item.new {
    background: var(--surface-inset);
    border-style: dashed;
    border-color: var(--border-strong);
    color: var(--text-muted);
  }
  .picker-item.new:hover {
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    color: var(--ink);
  }
  .picker-item :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .picker-item span:first-of-type {
    flex: 1;
  }
  .picker-tag {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .cell,
    .colh {
      transition: none;
    }
  }
</style>
