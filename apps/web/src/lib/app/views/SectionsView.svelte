<script lang="ts">
  /* Sections / Setlist — the real model (U4): each section is a FLAT ORDERED LIST of
     reusable GRAPHS. Columns = the active song's sections; each column is that section's
     ordered graph list. A row references a trigger graph by key, so the same graph can
     appear in many sections (reuse). Clicking a section header makes it the active section
     (you play + edit it); clicking a graph row activates its section AND opens it in the
     Trigger canvas (highlighted). The "+ graph" button opens the picker drawer to add a
     graph (existing or new) to that section; the × removes it. Layering is now two graphs
     in a section that share a trigger source — no per-pad slot grid. */
  import { isAuthoredGraphKey, type TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { isReused } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import CommitInput from '../../ui/CommitInput.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import Drawer from '../../ui/Drawer.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Copy from '@lucide/svelte/icons/copy';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import Workflow from '@lucide/svelte/icons/workflow';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const song = $derived(store.activeSong);
  const sections = $derived(song?.sections ?? []);

  // graph picker: the section awaiting a graph (or null when closed)
  let pendingSectionId = $state<string | null>(null);
  const pendingSection = $derived(
    pendingSectionId ? sections.find((s) => s.id === pendingSectionId) ?? null : null,
  );

  // inline rename: the section whose header is in edit mode (or null)
  let editingSectionId = $state<string | null>(null);

  function commitRename(sectionId: string, name: string): void {
    store.renameSection(sectionId, name);
    editingSectionId = null;
  }
  /** Delete a section via the context menu; drop out of edit mode first if it was renaming. */
  function deleteSection(sectionId: string): void {
    if (editingSectionId === sectionId) editingSectionId = null;
    store.removeSection(sectionId);
  }

  // inline rename for an AUTHORED graph row — which row (section + key) is editing, or null.
  // Keyed by section too so the field opens only in the right-clicked row when a graph is reused.
  let editingGraph = $state<{ sectionId: string; key: string } | null>(null);

  function commitGraphRename(key: string, name: string): void {
    store.renameGraph(key, name);
    editingGraph = null;
  }
  /** Delete an authored graph everywhere via the context menu; leave edit mode if it was renaming. */
  function deleteGraph(key: string): void {
    if (editingGraph?.key === key) editingGraph = null;
    store.deleteGraph(key);
  }

  /** The graph's source sub line (e.g. "Kick · center", "MIDI note 38") for a row + picker. */
  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }

  /** Open a graph: activate its section + open it on the canvas (highlighted), then navigate. */
  function openGraph(sectionId: string, key: string): void {
    store.selectGraphInSection(sectionId, key);
    shell.setView('trigger');
  }
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
    <button class="addsection" type="button" onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}>
      <Plus size={14} aria-hidden="true" /> Section
    </button>
  </header>

  {#if song}
    <div class="cols">
      {#each sections as sec (sec.id)}
        {@const active = store.activeSectionId === sec.id}
        {@const editing = editingSectionId === sec.id}
        {@const actions = [
          { label: 'Rename', icon: Pencil, onSelect: () => (editingSectionId = sec.id) },
          { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateSection(sec.id) },
          { label: 'Delete', icon: Trash2, danger: true, onSelect: () => deleteSection(sec.id) },
        ] satisfies ContextMenuAction[]}
        <section class="col" class:active>
          <ContextMenu {actions}>
            <div class="colh-row">
              {#if editing}
                <div class="colh-edit">
                  <CommitInput
                    value={sec.name}
                    ariaLabel="Section name"
                    onCommit={(name) => commitRename(sec.id, name)}
                    onCancel={() => (editingSectionId = null)}
                  />
                </div>
              {:else}
                <button
                  class="colh"
                  class:active
                  onclick={() => store.setActiveSection(sec.id)}
                  ondblclick={() => (editingSectionId = sec.id)}
                  title="Double-click or right-click to rename"
                >
                  <span class="colname">{sec.name}</span>
                  <span class="colcount">{sec.graphs.length}</span>
                </button>
              {/if}
              <div class="colh-actions">
                <IconButton icon={Copy} label="Copy section" size={13} onclick={() => store.copySection(sec.id)} />
                <IconButton
                  icon={ClipboardPaste}
                  label="Paste section"
                  size={13}
                  disabled={!store.sectionClipboard}
                  onclick={() => store.pasteSection()}
                />
              </div>
            </div>
          </ContextMenu>

          <div class="graphlist">
            {#each sec.graphs as key (key)}
              {@const current = active && store.selectedPadKey === key}
              {@const reused = isReused(song, key)}
              {@const rowEditing = editingGraph?.sectionId === sec.id && editingGraph?.key === key}
              {@const authored = isAuthoredGraphKey(key)}
              {@const rowActions = [
                ...(authored
                  ? [{ label: 'Rename', icon: Pencil, onSelect: () => (editingGraph = { sectionId: sec.id, key }) }]
                  : []),
                { label: 'Remove from section', icon: X, onSelect: () => store.removeGraphFromSection(sec.id, key) },
                ...(authored ? [{ label: 'Delete graph', icon: Trash2, danger: true, onSelect: () => deleteGraph(key) }] : []),
              ] satisfies ContextMenuAction[]}
              <ContextMenu actions={rowActions}>
                <div class="grow" class:current class:reused>
                  {#if rowEditing}
                    <div class="grow-edit">
                      <CommitInput
                        value={store.graphLabel(key)}
                        ariaLabel="Graph name"
                        onCommit={(name) => commitGraphRename(key, name)}
                        onCancel={() => (editingGraph = null)}
                      />
                    </div>
                  {:else}
                    <button class="grow-main" title="Open {store.graphLabel(key)}" onclick={() => openGraph(sec.id, key)}>
                      <Workflow size={12} aria-hidden="true" />
                      <span class="grow-text">
                        <span class="grow-label">{store.graphLabel(key)}</span>
                        <span class="grow-sub">{sourceSub(key)}</span>
                      </span>
                      {#if reused}<span class="reuse-dot" title="Reused in another section" aria-hidden="true"></span>{/if}
                    </button>
                    <div class="grow-actions">
                      <IconButton icon={X} label="Remove from section" size={12} onclick={() => store.removeGraphFromSection(sec.id, key)} />
                    </div>
                  {/if}
                </div>
              </ContextMenu>
            {/each}

            {#if sec.graphs.length === 0}
              <p class="empty">No graphs yet.</p>
            {/if}

            <button class="addgraph" type="button" title="Add a graph" onclick={() => (pendingSectionId = sec.id)}>
              <Plus size={13} aria-hidden="true" /> graph
            </button>
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<Drawer open={!!pendingSection} onClose={() => (pendingSectionId = null)} title="Add a graph" side="right" width="320px">
  {#if pendingSection}
    <p class="picker-ctx">{pendingSection.name}</p>
    <div class="picker-list">
      <button class="picker-item new" onclick={createAndPlace}>
        <Plus size={14} aria-hidden="true" />
        <span>New graph</span>
        <span class="picker-tag">empty</span>
      </button>
      {#each store.graphLibrary as g (g.key)}
        {@const inSection = pendingSection.graphs.includes(g.key)}
        <button class="picker-item" disabled={inSection} onclick={() => place(g.key)}>
          <Workflow size={14} aria-hidden="true" />
          <span class="picker-label">
            <span>{g.label}</span>
            <span class="picker-sub">{sourceSub(g.key)}</span>
          </span>
          {#if inSection}<span class="picker-tag">in section</span>{/if}
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
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 0 0 232px;
    padding: var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition: border-color 120ms ease;
  }
  .col.active {
    border-color: color-mix(in oklch, var(--accent) 45%, var(--border));
  }
  .colh-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  /* inline-rename slot — fills the header like .colh; CommitInput draws its own field */
  .colh-edit {
    display: flex;
    flex: 1;
    min-width: 0;
  }
  .colh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
  }
  /* copy / paste affordance, revealed on header hover (mirrors .grow-actions) */
  .colh-actions {
    display: none;
    align-items: center;
    flex: none;
  }
  .colh-row:hover .colh-actions {
    display: inline-flex;
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
  .colname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .colcount {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .graphlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .grow {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 38px;
    padding: 2px 4px 2px 2px;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition: border-color 120ms ease, background-color 120ms ease;
  }
  .grow.current {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
    background: var(--accent-soft);
  }
  /* inline-rename slot for an authored graph row — fills the row; CommitInput draws its field */
  .grow-edit {
    display: flex;
    flex: 1;
    min-width: 0;
  }
  .grow-main {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: 4px var(--space-1);
    background: transparent;
    border: none;
    text-align: left;
    color: var(--accent);
  }
  .grow-main :global(svg) {
    flex: none;
    opacity: 0.85;
  }
  .grow-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .grow-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--ink);
  }
  .grow-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .reuse-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .grow-actions {
    display: none;
    align-items: center;
    flex: none;
  }
  .grow:hover .grow-actions {
    display: inline-flex;
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
    transition: color 120ms ease, border-color 120ms ease;
  }
  .addgraph:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .addgraph:active {
    scale: 0.98;
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
  .picker-item:hover:not(:disabled) {
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    color: var(--ink);
  }
  .picker-item:active:not(:disabled) {
    scale: 0.98;
  }
  .picker-item:disabled {
    opacity: 0.5;
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
  .picker-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .picker-sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .picker-tag {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .grow,
    .col,
    .colh,
    .addgraph {
      transition: none;
    }
  }
</style>
