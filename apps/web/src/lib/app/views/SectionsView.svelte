<script lang="ts">
  /* Sections / Setlist — the real model: each section is a FLAT ORDERED LIST of reusable
     GRAPHS. Columns = the active song's sections; each column (SectionColumn) is that section's
     ordered graph list. A row references a trigger graph by key, so the same graph can appear in
     many sections (reuse). Clicking a section header makes it the active section; clicking a graph
     row activates its section AND opens it in the Trigger canvas. The "+ graph" button opens the
     GraphPickerDrawer to add a graph (existing or new) to that section. This view owns the
     multi-column layout + the picker state; the column/row/picker chrome lives in sub-components. */
  import { type TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { sectionRecall } from '../recall';
  import SectionColumn from './SectionColumn.svelte';
  import GraphPickerDrawer from './GraphPickerDrawer.svelte';
  import SectionInspector from '../docks/inspectors/SectionInspector.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import X from '@lucide/svelte/icons/x';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const song = $derived(store.activeSong);
  const sections = $derived(song?.sections ?? []);

  // --- selected section detail (rename + transport recall), inline in this view -----
  // Resolves over the RESOLVED song list (S42) so a referenced section resolves, and the
  // recall index matches the server (which receives the resolved setlist order via
  // buildShow). Searches ALL songs so the panel stays correct if the active song changes
  // while a section is inspected.
  const sectionSel = $derived.by(() => {
    const sel = shell.selection;
    if (sel?.kind !== 'section') return null;
    const songIdx = store.resolvedSongs.findIndex((s) => s.sections.some((sec) => sec.id === sel.sectionId));
    if (songIdx < 0) return null;
    const owner = store.resolvedSongs[songIdx]!;
    const sectionIdx = owner.sections.findIndex((sec) => sec.id === sel.sectionId);
    const section = owner.sections[sectionIdx]!;
    return { song: owner, section, sectionIdx, recall: sectionRecall(songIdx, sectionIdx) };
  });

  // graph picker: the section awaiting a graph (or null when closed)
  let pendingSectionId = $state<string | null>(null);
  const pendingSection = $derived(
    pendingSectionId ? (sections.find((s) => s.id === pendingSectionId) ?? null) : null,
  );

  function place(graphKey: string): void {
    if (!pendingSectionId) return;
    store.addGraphToSection(pendingSectionId, graphKey);
    pendingSectionId = null;
  }
  /** Author a fresh graph, add it to the pending section, activate + open it for editing. */
  function createAndPlace(): void {
    if (!pendingSectionId) return;
    const sectionId = pendingSectionId;
    const key = store.createGraph();
    store.addGraphToSection(sectionId, key);
    store.selectGraphInSection(sectionId, key);
    pendingSectionId = null;
    shell.setView('trigger'); // land on the canvas to edit the new graph
  }
</script>

<div class="sections-view">
  <header class="head">
    <div class="title">
      <Eyebrow icon={LayoutGrid}>Setlist</Eyebrow>
      <h2>{song?.name ?? 'No song'}</h2>
    </div>
    {#if store.canEdit}
      <button class="addsection" type="button" onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}>
        <Plus size={14} aria-hidden="true" /> Section
      </button>
    {/if}
  </header>

  {#if song}
    <div class="body" class:with-detail={!!sectionSel}>
      <div class="cols">
        {#each sections as sec (sec.id)}
          <SectionColumn {store} {shell} {song} section={sec} onAddGraph={(id) => (pendingSectionId = id)} />
        {/each}
      </div>

      {#if sectionSel}
        {@const ss = sectionSel}
        <aside class="detail">
          <PanelHeader icon={SlidersHorizontal} title="Section">
            <IconButton icon={X} label="Close section settings" size={14} onclick={() => shell.clearSelection()} />
          </PanelHeader>
          <div class="detail-body">
            <SectionInspector
              {store}
              sectionId={ss.section.id}
              sectionName={ss.section.name}
              songName={ss.song.name}
              sectionIdx={ss.sectionIdx}
              recall={ss.recall}
              looks={ss.section.looks}
            />
          </div>
        </aside>
      {/if}
    </div>
  {/if}
</div>

<GraphPickerDrawer
  {store}
  section={pendingSection}
  onPlace={place}
  onCreate={createAndPlace}
  onClose={() => (pendingSectionId = null)}
/>

<style>
  .sections-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--shell-gap);
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
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--shell-gap);
    min-height: 0;
  }
  .body.with-detail {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
  .cols {
    display: flex;
    gap: var(--space-2);
    align-items: start;
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .detail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .detail-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
