<script lang="ts">
  /* Sections / Setlist (effect chains S06c). Columns = the active song's sections; each column
     (SectionColumn) summarises that section's Effect grid — one row per occupied cell with its
     Effect names, plus the Master chain. Clicking a cell row activates its section, selects the
     cell and opens the Effects view. Section arrangement (reorder by drag, move / copy / paste
     via the section menu, rename, duplicate) is unchanged. The graph linking UI is gone (v1 has
     no linked placements; copy / paste replaces them). This view owns the multi-column layout,
     the section drag and the inline section detail. */
  import { type TriggerLab } from '../../trigger-lab/store.svelte';
  import type { EffectsAuthoringApi } from '../../trigger-lab/effects-api';
  import type { ShellStore } from '../shell-store.svelte';
  import { sectionRecall } from '../recall';
  import { hasPrimaryModifier, isEditableShortcutTarget, platformShortcutModifier, type ShortcutPlatform } from '../primary-shortcut';
  import SectionColumn from './SectionColumn.svelte';
  import { columnGapIndexAt } from './sections-dnd';
  import { sectionsDndPreview } from './sections-dnd-preview.svelte';
  import SectionInspector from '../docks/inspectors/SectionInspector.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import X from '@lucide/svelte/icons/x';

  let {
    store,
    shell,
    api = store as unknown as EffectsAuthoringApi, // TODO(ec-w4): store-wire
  }: { store: TriggerLab; shell: ShellStore; api?: EffectsAuthoringApi } = $props();

  const song = $derived(store.activeSong);
  const sections = $derived(song?.sections ?? []);
  const shortcutPlatform: ShortcutPlatform = platformShortcutModifier(globalThis.navigator?.platform ?? '');

  /** The section being dragged (reorder), or null. */
  let draggingId = $state<string | null>(null);

  // Drop-target indicator: the gap between columns a dragged section would land in (vertical
  // insert-line). Clears on drop / cancel (via clearDrag, wired to dragend). In dev, the
  // screenshot seam can pin one so ui-shot can capture this otherwise drag-only state.
  let sectionGap = $state<number | null>(null);
  let colsEl = $state<HTMLDivElement | null>(null);

  const preview = $derived(import.meta.env.DEV ? sectionsDndPreview.current : null);
  const draggingSection = $derived(draggingId != null || preview?.kind === 'section');

  // The section-reorder gap index (0..sections.length), from live drag state or the
  // pinned preview. `??` is nullish so gap 0 (drop before the first column) survives.
  const sectionGapIdx = $derived(
    sectionGap ?? (preview?.kind === 'section' ? preview.index : null),
  );

  // Geometry of the vertical insert-line for the current section gap: an x in the
  // scrolling `.cols` content, plus the top/height of the tallest column so the bar
  // spans the row. Recomputed on each dragover (sectionGap changes) and for the preview.
  let sectionLine = $state<{ x: number; top: number; height: number } | null>(null);
  $effect(() => {
    const gap = draggingSection ? sectionGapIdx : null;
    if (gap == null || !colsEl) {
      sectionLine = null;
      return;
    }
    const cols = Array.from(colsEl.querySelectorAll<HTMLElement>('[data-section-col]'));
    if (cols.length === 0) {
      sectionLine = null;
      return;
    }
    const host = colsEl.getBoundingClientRect();
    const rects = cols.map((c) => c.getBoundingClientRect());
    const half = 6; // ~half the inter-column gap (--space-3 = 12px), for edge lines
    let vx: number;
    if (gap <= 0) vx = rects[0]!.left - half;
    else if (gap >= rects.length) vx = rects[rects.length - 1]!.right + half;
    else vx = (rects[gap - 1]!.right + rects[gap]!.left) / 2;
    // viewport → scrolling content coordinates
    const x = Math.max(1, vx - host.left + colsEl.scrollLeft);
    const top = Math.min(...rects.map((r) => r.top)) - host.top + colsEl.scrollTop;
    const height = Math.max(...rects.map((r) => r.height));
    sectionLine = { x, top, height };
  });

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

  function onKey(e: KeyboardEvent): void {
    if (!store.canEdit || e.defaultPrevented || isEditableShortcutTarget(e.target)) return;
    if (e.key.toLowerCase() !== 'd' || !hasPrimaryModifier(e, shortcutPlatform)) return;
    const sel = shell.selection;
    if (sel?.kind !== 'section') return;
    if (!sections.some((sec) => sec.id === sel.sectionId)) return;
    e.preventDefault();
    store.duplicateSection(sel.sectionId);
  }

  function startSectionDrag(sectionId: string, event: DragEvent): void {
    if (!store.canEdit) return;
    draggingId = sectionId;
    event.dataTransfer?.setData('text/plain', sectionId);
    event.dataTransfer?.setData('application/x-ledrums-section', sectionId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function clearDrag(): void {
    draggingId = null;
    sectionGap = null;
  }

  /** The gap index (0..sections.length) the pointer X sits at across the columns row. */
  function sectionGapAt(clientX: number): number {
    const cols = Array.from(colsEl?.querySelectorAll<HTMLElement>('[data-section-col]') ?? []);
    return columnGapIndexAt(
      cols.map((c) => c.getBoundingClientRect()),
      clientX,
    );
  }

  /** A section is being dragged over the columns row: arm the vertical insert-line at the
      pointer's gap. Handled at the `.cols` level so hovering the empty inter-column gaps
      (not just a column) still resolves a target. */
  function onColsDragOver(event: DragEvent): void {
    if (!store.canEdit || draggingId == null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    sectionGap = sectionGapAt(event.clientX);
  }

  function onColsDrop(event: DragEvent): void {
    if (!store.canEdit || draggingId == null) return;
    event.preventDefault();
    event.stopPropagation();
    const id = draggingId;
    store.moveSection(id, sectionGapAt(event.clientX));
    store.setActiveSection(id);
    shell.select({ kind: 'section', sectionId: id });
    clearDrag();
  }

  /** Clear the indicator when the pointer leaves the columns region (not just one
      column) mid-drag, so a stale line doesn't linger over the detail pane. */
  function onColsDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget instanceof Node && event.currentTarget.contains(related)) return;
    sectionGap = null;
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="sections-view">
  <header class="head">
    <div class="title">
      <LayoutGrid size={15} aria-hidden="true" class="title-icon" />
      <h2>{song?.name ?? 'No song'}</h2>
    </div>
    <button
      class="addsection"
      type="button"
      disabled={!store.canEditActiveSong}
      title={store.activeSongEditBlockReason ?? 'Add section'}
      onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}
    >
      <Plus size={14} aria-hidden="true" /> Section
    </button>
    {#if !store.canEditActiveSong && store.activeSongEditBlockReason}
      <span class="readonly-reason">{store.activeSongEditBlockReason}</span>
    {/if}
  </header>

  {#if song}
    <div class="body" class:with-detail={!!sectionSel}>
      <div
        class="cols"
        role="list"
        aria-label="Sections"
        bind:this={colsEl}
        ondragover={onColsDragOver}
        ondrop={onColsDrop}
        ondragleave={onColsDragLeave}
      >
        {#each sections as sec (sec.id)}
          <SectionColumn
            {store}
            {api}
            {shell}
            {song}
            section={sec}
            onSectionDragStart={(event) => startSectionDrag(sec.id, event)}
            onDragEnd={clearDrag}
          />
        {/each}
        {#if draggingSection && sectionLine}
          <div
            class="section-insert-line"
            aria-hidden="true"
            style:left="{sectionLine.x}px"
            style:top="{sectionLine.top}px"
            style:height="{sectionLine.height}px"
          ></div>
        {/if}
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
              canEdit={store.canEditActiveSong && store.isLocalSong(ss.song.id)}
              editBlockReason={store.activeSongEditBlockReason ?? undefined}
            />
          </div>
        </aside>
      {/if}
    </div>
  {/if}
</div>

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
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .title h2 {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-label);
  }
  /* :global — the class lands on the Lucide component's rendered <svg>, which
     scoped selectors can't reach; scoped under .title so it can't leak. */
  .title :global(.title-icon) {
    color: var(--accent);
    filter: drop-shadow(0 0 8px color-mix(in oklab, var(--accent), transparent 58%));
  }
  .addsection {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-control-sm);
    background: color-mix(in oklab, var(--accent), transparent 90%);
    color: var(--text-strong);
    font-size: var(--text-2xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-label);
    cursor: pointer;
  }
  .addsection:hover {
    border-color: color-mix(in oklab, var(--accent), var(--border) 45%);
    background: color-mix(in oklab, var(--accent), transparent 84%);
  }
  .addsection:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .readonly-reason {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-size: var(--text-2xs);
  }
  .body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--shell-gap);
  }
  .body.with-detail {
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  }
  .cols {
    position: relative;
    min-height: 0;
    overflow: auto;
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    padding-bottom: var(--space-2);
  }
  /* Section-reorder insert-line. A 2px accent bar pinned in the gap between the
     columns the section would land between; positioned absolutely (no layout shift)
     from geometry so it also reaches the leading/trailing gaps. */
  .section-insert-line {
    position: absolute;
    width: 2px;
    transform: translateX(-1px);
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in oklch, var(--accent) 60%, transparent);
    pointer-events: none;
    z-index: var(--z-docked);
    animation: section-insert-line-in var(--dur-120) var(--ease-control, ease);
  }
  @keyframes section-insert-line-in {
    from {
      opacity: 0;
      scale: 1 0.6;
    }
    to {
      opacity: 1;
      scale: 1 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .section-insert-line {
      animation: none;
    }
  }
  .detail {
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    background: color-mix(in oklab, var(--surface), black 8%);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .detail-body {
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
  }
</style>
