<script lang="ts">
  /* One section column in the setlist: an EditableRow header (rename / activate / duplicate /
     delete, with the section menu) over a compact per-cell Effect summary — one row per occupied
     grid cell, showing its Effect names in stack order, then the Master chain when it has
     modifiers. Clicking a cell row makes this the active section, selects that cell and opens
     the Effects view; "Edit effects" opens the section's grid with nothing selected.

     Section arrangement (reorder, rename, copy / paste, move) goes through the store; Effect
     reads and selection go through the authoring api. The multi-column layout and section drag
     are owned by SectionsView. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { MASTER_CELL, type CellSelection, type EffectsAuthoringApi } from '../../trigger-lab/effects-api';
  import { sameCell } from '../../trigger-lab/effects-doc';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Song, SetlistSection } from '../setlist';
  import EditableRow from '../../ui/EditableRow.svelte';
  import ContextMenu from '../../ui/ContextMenu.svelte';
  import { sectionActions } from '../section-actions';
  import { sectionCellSummaries, sectionEffectCount, sectionMasterSummary } from './section-effects';
  import SectionCellRow from './SectionCellRow.svelte';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';

  let {
    store,
    api,
    shell,
    song,
    section,
    onSectionDragStart,
    onDragEnd,
  }: {
    store: TriggerLab;
    api: EffectsAuthoringApi;
    shell: ShellStore;
    song: Song;
    section: SetlistSection;
    onSectionDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  } = $props();

  let editing = $state(false);
  const active = $derived(store.activeSectionId === section.id);
  const canArrange = $derived(store.canEditActiveSong && store.isLocalSong(song.id));
  const blockedReason = $derived(store.isViewer ? 'Another client is editing' : 'Library section is read-only — detach a copy in Objects to edit it');

  // The `?? []` only covers the pre-store-wire store (no grid read models yet).
  const cells = $derived(sectionCellSummaries(section, api.gridRows, api.gridColumns));
  const master = $derived(sectionMasterSummary(section));
  const effectCount = $derived(sectionEffectCount(section));

  function isOpen(cell: CellSelection): boolean {
    const sel = api.selectedCell;
    if (!active || sel == null) return false;
    if (sel === MASTER_CELL || cell === MASTER_CELL) return sel === cell;
    return sameCell(sel, cell);
  }

  function selectSection(): void {
    store.setActiveSection(section.id);
    shell.select({ kind: 'section', sectionId: section.id });
  }

  /** Activate this section, select `cell` (or nothing) and land on the Effects view. */
  function openInEffects(cell: CellSelection | null): void {
    store.setActiveSection(section.id);
    api.selectCell(cell);
    shell.setView('trigger');
  }

  const actions = $derived(sectionActions(store, section.id, () => requestAnimationFrame(() => (editing = true)), api));
</script>

<section class="col" class:active role="listitem" data-section-col>
  <div
    class="section-drag"
    role="group"
    draggable={canArrange && !editing}
    aria-label={`Drag ${section.name}`}
    ondragstart={onSectionDragStart}
    ondragend={onDragEnd}
  >
    <EditableRow
      label={section.name}
      {active}
      bind:editing
      onclick={selectSection}
      onCommit={(name) => store.renameSection(section.id, name)}
      actions={actions.filter((action) => action.label !== 'Rename')}
      renameLabel="Section name"
      renameDisabled={!canArrange}
      renameDisabledLabel={blockedReason}
    >
      {#snippet trailing()}
        <span class="colcount" title={`${effectCount} ${effectCount === 1 ? 'effect' : 'effects'}`}>{effectCount}</span>
        <ContextMenu mode="dropdown" label={`Actions for ${section.name}`} {actions}>
          <Ellipsis size={16} aria-hidden="true" />
        </ContextMenu>
      {/snippet}
    </EditableRow>
  </div>

  <div class="celllist" role="list" aria-label={`${section.name} cells`}>
    {#if master}
      <div role="listitem">
        <SectionCellRow
          row="Master"
          column={`${master.names.length} ${master.names.length === 1 ? 'modifier' : 'modifiers'}`}
          names={master.names}
          master
          bypassed={master.allBypassed}
          active={isOpen(MASTER_CELL)}
          onOpen={() => openInEffects(MASTER_CELL)}
        />
      </div>
    {/if}
    {#each cells as cell (cell.key)}
      <div role="listitem">
        <SectionCellRow
          row={cell.rowLabel}
          column={cell.columnLabel}
          names={cell.names}
          color={cell.color}
          bypassed={cell.allBypassed}
          active={isOpen(cell.cell)}
          onOpen={() => openInEffects(cell.cell)}
        />
      </div>
    {/each}

    {#if cells.length === 0 && !master}
      <p class="empty">No effects yet.</p>
    {/if}

    <button class="editgrid" type="button" title="Open this section's grid in the Effects view" onclick={() => openInEffects(null)}>
      <Grid3x3 size={13} aria-hidden="true" /> Edit effects
    </button>
  </div>
</section>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 0 0 232px;
    padding: var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  /* Active-section border. Mixed in oklab (rectangular), NOT oklch: oklch interpolates
     the HUE ARC from lime (128°) through cyan (~205°) to the blue-grey border (256°), so
     an oklch mix reads as a cyan/blue "selection" ring — the treatment Trent flagged while
     dragging (R11b-1). oklab keeps it a muted accent-green, in the same language as the
     insert-lines. */
  .col.active {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  }
  .section-drag {
    cursor: grab;
  }
  .section-drag:active {
    cursor: grabbing;
  }
  .colcount {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .celllist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 42px;
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .editgrid {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    min-height: 32px;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-card);
    transition: none;
  }
  .editgrid:hover {
    color: var(--accent);
    border-color: var(--border-accent);
    background: var(--surface-inset);
  }
  .editgrid:active {
    scale: 1;
  }
</style>
