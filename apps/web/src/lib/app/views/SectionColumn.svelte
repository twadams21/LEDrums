<script lang="ts">
  /* One section column in the setlist: an EditableRow header (rename / activate / duplicate /
     delete, with hover copy + paste) over the section's ordered graph rows and an "add graph"
     button. Clicking the header makes this the active (played + edited) section and loads it
     into the right-dock Inspector. The multi-column setlist layout is owned by SectionsView. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Song, SetlistSection } from '../setlist';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import SectionGraphRow from './SectionGraphRow.svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';

  let {
    store,
    shell,
    song,
    section,
    draggingKind,
    onAddGraph,
    onSectionDragStart,
    onGraphDragStart,
    onDragEnd,
    onDragOver,
    onSectionDrop,
    onGraphDrop,
  }: {
    store: TriggerLab;
    shell: ShellStore;
    song: Song;
    section: SetlistSection;
    draggingKind: 'section' | 'graph' | null;
    onAddGraph: (sectionId: string) => void;
    onSectionDragStart: (event: DragEvent) => void;
    onGraphDragStart: (graphKey: string, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onSectionDrop: (event: DragEvent) => void;
    onGraphDrop: (graphIndex: number, event: DragEvent) => void;
  } = $props();

  let editing = $state(false);
  const active = $derived(store.activeSectionId === section.id);

  function selectSection(): void {
    store.setActiveSection(section.id);
    shell.select({ kind: 'section', sectionId: section.id });
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateSection(section.id) },
    { label: 'Copy', icon: Copy, onSelect: () => void store.copySectionToClipboard(section.id) },
    { label: 'Paste', icon: ClipboardPaste, onSelect: () => void store.pasteSectionFromClipboard() },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => store.removeSection(section.id) },
  ]);
</script>

<section class="col" class:active role="listitem" ondragover={onDragOver} ondrop={onSectionDrop}>
  <div
    class="section-drag"
    role="group"
    draggable={store.canEdit && !editing}
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
      {actions}
      renameLabel="Section name"
    >
      {#snippet trailing()}<span class="colcount">{section.graphs.length}</span>{/snippet}
      {#snippet quickActions()}
        <IconButton icon={Copy} label="Copy section to clipboard" size={13} onclick={() => void store.copySectionToClipboard(section.id)} />
        <IconButton icon={ClipboardPaste} label="Paste section" size={13} onclick={() => void store.pasteSectionFromClipboard()} />
      {/snippet}
    </EditableRow>
  </div>

  <div class="graphlist" class:drop-active={draggingKind === 'graph'} role="list" ondragover={onDragOver} ondrop={onSectionDrop}>
    {#each section.graphs as key, i (key)}
      <SectionGraphRow
        {store}
        {shell}
        {song}
        {section}
        graphKey={key}
        onDragStart={(event) => onGraphDragStart(key, event)}
        {onDragEnd}
        onDragOver={onDragOver}
        onDrop={(event) => onGraphDrop(i, event)}
      />
    {/each}

    {#if section.graphs.length === 0}
      <p class="empty">No graphs yet.</p>
    {/if}

    <button class="addgraph" type="button" title="Add a graph" onclick={() => onAddGraph(section.id)}>
      <Plus size={13} aria-hidden="true" /> graph
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
    border-radius: var(--radius-2);
    transition: border-color var(--dur-120) ease;
  }
  .col.active {
    border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
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
  .graphlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 42px;
    border-radius: calc(var(--radius-2) - 2px);
    transition:
      background-color var(--dur-120) ease,
      box-shadow var(--dur-120) ease;
  }
  .graphlist.drop-active {
    background: color-mix(in oklch, var(--accent) 6%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 25%, transparent);
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .addgraph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-2);
    transition:
      color var(--dur-120) ease,
      border-color var(--dur-120) ease;
  }
  .addgraph:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .addgraph:active {
    scale: 0.98;
  }
  @media (prefers-reduced-motion: reduce) {
    .col,
    .addgraph,
    .graphlist {
      transition: none;
    }
  }
</style>
