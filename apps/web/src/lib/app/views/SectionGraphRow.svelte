<script lang="ts">
  /* One graph row inside a section column. Clicking opens the graph on the Trigger canvas
     (and activates its section); the trailing dot marks a graph reused in another section.
     CRUD via the right-click menu (rename / duplicate / remove-from-section / delete) with a
     hover quick-action for the common "remove from section". */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Song, SetlistSection } from '../setlist';
  import { isReused } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import StatusDot from '../../ui/StatusDot.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';

  let {
    store,
    shell,
    song,
    section,
    graphKey,
    onDragStart,
    onDragEnd,
  }: {
    store: TriggerLab;
    shell: ShellStore;
    song: Song;
    section: SetlistSection;
    graphKey: string;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  } = $props();

  let editing = $state(false);
  let dragging = $state(false);
  let ghostEl = $state<HTMLDivElement | null>(null);
  const current = $derived(store.activeSectionId === section.id && store.selectedPadKey === graphKey);
  const reused = $derived(isReused(song, graphKey));
  const sub = $derived(describeTriggerSource(store.triggerSource(graphKey), store.drums).sub);

  /* The native HTML5 drag ghost snapshots the whole row — grip, status dot, and the
     hover-revealed ✕ — semi-transparent over the still-visible original, reading as a
     broken double. Instead: pin a clean compact drag image (icon + name only) and dim
     the source row so there's a single "this is moving" representation (R11b). */
  function handleDragStart(event: DragEvent): void {
    if (ghostEl && event.dataTransfer) event.dataTransfer.setDragImage(ghostEl, 12, 16);
    dragging = true;
    onDragStart(event);
  }
  function handleDragEnd(): void {
    dragging = false;
    onDragEnd();
  }

  function open(): void {
    store.selectGraphInSection(section.id, graphKey);
    shell.setView('trigger');
  }
  function removeFromSection(): void {
    store.removeGraphFromSection(section.id, graphKey);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateGraph(graphKey) },
    { label: 'Remove from section', icon: X, onSelect: removeFromSection },
    { label: 'Delete graph', icon: Trash2, danger: true, onSelect: () => store.deleteGraph(graphKey) },
  ]);
</script>

<div
  class="graph-drag"
  class:dragging
  role="listitem"
  data-graph-row
  draggable={store.canEdit && !editing}
  aria-label={`Drag ${store.graphLabel(graphKey)}`}
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
>
  {#if store.canEdit && !editing}
    <!-- Explicit drag affordance: the grab cursor is confined to this grip rather than smeared
         across the whole row (R12). Faint at rest, brightens with the row on hover. -->
    <span class="grip" aria-hidden="true"><GripVertical size={13} /></span>
  {/if}
  <EditableRow
    icon={Workflow}
    label={store.graphLabel(graphKey)}
    secondary={sub}
    active={current}
    bind:editing
    onclick={open}
    onCommit={(name) => store.renameGraph(graphKey, name)}
    {actions}
    renameLabel="Graph name"
  >
    {#snippet trailing()}
      {#if reused}<StatusDot tone="accent" />{/if}
    {/snippet}
    {#snippet quickActions()}
      <IconButton icon={X} label="Remove from section" size={12} onclick={removeFromSection} />
    {/snippet}
  </EditableRow>

  {#if store.canEdit && !editing}
    <!-- Compact drag image: rendered off-screen (never display:none — Chrome won't snapshot
         a hidden node) and handed to setDragImage on dragstart. Icon + name only, no ✕. -->
    <div class="drag-ghost" bind:this={ghostEl} aria-hidden="true">
      <Workflow size={13} />
      <span>{store.graphLabel(graphKey)}</span>
    </div>
  {/if}
</div>

<style>
  /* Each graph row is a raised tile in the trigger-graph-thumbnail language (GraphsDock
     `.gcard`): the `--surface-2` thumb surface, a faint border, and square (`--radius-card`)
     corners matching the Objects view. Hover lifts the border like the thumbs rather than
     swapping the fill, so the inner ListItem's own hover/active states stay legible. */
  .graph-drag {
    position: relative;
    min-height: 40px;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    /* Row content sits past the grip gutter; the grip is absolutely positioned within it so the
       row layout (and its Workflow icon) is unshifted. */
    padding-inline-start: var(--space-4);
    transition:
      opacity var(--dur-120) ease,
      border-color var(--dur-120) ease;
  }
  .graph-drag:hover {
    border-color: var(--border-strong);
  }
  /* Drag source: dim the original so the moving row reads as the compact drag image,
     not a second full-layout copy. Opacity only — no layout jump. */
  .graph-drag.dragging {
    opacity: 0.4;
  }
  /* Off-screen drag-image template (see setDragImage). Kept in normal flow but parked far
     off-canvas so it has real dimensions to snapshot without affecting layout. */
  .drag-ghost {
    position: fixed;
    top: -9999px;
    inset-inline-start: -9999px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    max-width: 200px;
    padding: var(--space-1_5) var(--space-2);
    background: var(--surface-3);
    border: 1px solid color-mix(in oklch, var(--accent) 45%, var(--border));
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-2);
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
  }
  .drag-ghost :global(svg) {
    flex: none;
    color: var(--accent);
  }
  /* The grip owns the grab affordance — the rest of the row keeps its default (select) cursor. */
  .grip {
    position: absolute;
    inset-inline-start: 1px;
    inset-block: 0;
    display: flex;
    align-items: center;
    color: var(--text-faint);
    cursor: grab;
    transition: color var(--dur-120) ease;
  }
  .graph-drag:hover .grip {
    color: var(--text-muted);
  }
  .grip:active {
    cursor: grabbing;
  }
  @media (prefers-reduced-motion: reduce) {
    .grip,
    .graph-drag {
      transition: none;
    }
  }
</style>
