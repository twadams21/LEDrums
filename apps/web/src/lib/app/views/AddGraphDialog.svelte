<script lang="ts">
  /* "+ Add graph" — the Trigger rail's picker (#177). A Dialog over the graph library with a
     filter box: every existing graph defaults to a COPY (duplicate under a name you give),
     with LINK as the explicit shared-key alternative. The same modal carries the brand-new-graph
     form. Thin over
     tested store verbs (addGraphToSection / copyGraphToSection / createGraphInSection) and
     the pure `add-graph-rows` filter; the caller opens the graph it gets back.

     It is also where the library gets tidied (Tim, 2026-09-27): graphs group under the drum zones
     Settings declares — a zone with no graph offers Create — or sort A–Z; each row says how many
     sections play it and whether it is an exact duplicate, and can be deleted; "Remove
     duplicates" clears every exact copy no section plays. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { SetlistSection } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import { graphPlacementCount } from '../setlist';
  import { copyNameFor, graphPickGroups, type GraphSort } from './add-graph-rows';
  import Dialog from '../../ui/Dialog.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import SearchField from '../../ui/SearchField.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Link2 from '@lucide/svelte/icons/link-2';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import CopyX from '@lucide/svelte/icons/copy-x';

  let {
    store,
    section,
    open,
    onClose,
    onAdded,
  }: {
    store: TriggerLab;
    /** The section the picked graph lands in. */
    section: SetlistSection | null;
    open: boolean;
    onClose: () => void;
    /** The graph key that was linked / copied / created — the caller opens it. */
    onAdded: (graphKey: string) => void;
  } = $props();

  let query = $state('');
  /** The row awaiting a copy name, or null when no copy is being named. */
  let copying = $state<string | null>(null);
  /** The new-graph form is showing its name field. */
  let naming = $state(false);

  let sort = $state<GraphSort>('zone');
  /** A graph a section plays, awaiting "delete everywhere" confirmation. */
  let deleting = $state<string | null>(null);
  let confirmingDedupe = $state(false);

  const SORT_OPTS = [
    { value: 'zone', label: 'By zone' },
    { value: 'name', label: 'A–Z' },
  ];

  const groups = $derived(
    graphPickGroups({
      library: store.graphLibrary,
      sectionGraphs: section?.graphs ?? [],
      zones: store.drumZones,
      sub: (key) => describeTriggerSource(store.triggerSource(key), store.project?.kit.drums ?? store.drums, store.project?.inputMap).sub,
      zoneOf: (key) => {
        const source = store.triggerSource(key);
        return source?.kind === 'drum' && source.zone !== '' ? { drumId: source.drumId, slot: Number(source.zone) } : null;
      },
      placements: (key) => graphPlacementCount(store.songs, key),
      duplicates: store.duplicateGraphKeys,
      query,
      sort,
    }),
  );
  /** Only computed while the dialog is open — it compares every graph. */
  const redundant = $derived(open ? store.redundantDuplicateGraphs.length : 0);
  const canPlace = $derived(store.canEditActiveSong && !!section);
  const blockReason = $derived(store.activeSongEditBlockReason ?? 'Choose a local section first');

  /** Close and clear every transient affordance, so a stale name field never lingers. */
  function dismiss(): void {
    query = '';
    copying = null;
    naming = false;
    deleting = null;
    confirmingDedupe = false;
    onClose();
  }

  function place(graphKey: string): void {
    if (!section || !canPlace || !store.addGraphToSection(section.id, graphKey)) return;
    onAdded(graphKey);
    dismiss();
  }

  function link(graphKey: string): void {
    place(graphKey);
  }

  function commitCopy(sourceKey: string, name: string): void {
    if (!section || !canPlace) return;
    const key = store.copyGraphToSection(section.id, sourceKey, name);
    if (!key) return;
    onAdded(key);
    dismiss();
  }

  /** Load a saved graph file into the section as a new graph. The file panel is async; the dialog
      stays open behind it so a cancel lands back here, not on the canvas. */
  async function fromFile(): Promise<void> {
    if (!section || !canPlace) return;
    const result = await store.loadGraphFileIntoSection(section.id);
    if (!result?.ok || !result.graphKey) return;
    onAdded(result.graphKey);
    dismiss();
  }

  function createForZone(zone: { drumId: string; slot: number }): void {
    if (!section || !canPlace) return;
    const key = store.createZoneGraphInSection(section.id, zone.drumId, zone.slot);
    if (!key) return;
    onAdded(key);
    dismiss();
  }

  /** An unused graph goes at once (Ctrl/⌘Z brings it back); one a section plays asks first,
      because it leaves every section that plays it. */
  function remove(key: string, placements: number): void {
    if (placements > 0) deleting = key;
    else store.deleteGraph(key);
  }

  function usage(placements: number): string {
    return placements === 0 ? 'Not in any section' : placements === 1 ? 'In 1 section' : `In ${placements} sections`;
  }

  function commitNew(name: string): void {
    if (!section || !canPlace) return;
    const key = store.createGraphInSection(section.id, name);
    if (!key) return;
    onAdded(key);
    dismiss();
  }
</script>

<Dialog {open} onClose={dismiss} title="Add graph" class="dlg-addgraph">
  <header class="ag-head">
    <Eyebrow icon={Workflow}>Add graph{section ? ` · ${section.name}` : ''}</Eyebrow>
    <span class="ag-spacer"></span>
    <IconButton icon={X} label="Close" onclick={dismiss} />
  </header>
  {#if !canPlace}<p class="ag-reason">{blockReason}</p>{/if}

  <div class="ag-bar">
    <SearchField bind:value={query} placeholder="Filter graphs…" ariaLabel="Filter graphs" autofocus />
    {#if naming}
      <span class="ag-name">
        <CommitInput
          value=""
          placeholder="Graph name…"
          ariaLabel="New graph name"
          allowEmpty
          onCommit={(name) => commitNew(name)}
          onCancel={() => (naming = false)}
        />
      </span>
    {:else}
      <button type="button" class="ag-new" disabled={!canPlace} title={blockReason} onclick={() => ((naming = true), (copying = null))}>
        <Plus size={14} aria-hidden="true" />
        New graph
      </button>
      <button type="button" class="ag-new" disabled={!canPlace} title={canPlace ? 'Load a saved graph file' : blockReason} onclick={() => void fromFile()}>
        <FolderOpen size={14} aria-hidden="true" />
        From file…
      </button>
    {/if}
  </div>

  <div class="ag-tools">
    <SegmentedControl value={sort} options={SORT_OPTS} onChange={(v) => (sort = v as GraphSort)} ariaLabel="Sort graphs" />
    <span class="ag-spacer"></span>
    <button
      type="button"
      class="ag-new"
      disabled={!store.canEdit || redundant === 0}
      title={redundant === 0 ? 'No unused duplicates' : 'Delete every exact copy of a graph that no section plays'}
      onclick={() => (confirmingDedupe = true)}
    >
      <CopyX size={14} aria-hidden="true" />
      Remove duplicates{redundant > 0 ? ` (${redundant})` : ''}
    </button>
  </div>

  <div class="ag-list">
    {#each groups as group (group.id)}
      <section class="ag-group" aria-label={group.title ?? 'Graphs'}>
        {#if group.title}
          <h4 class="ag-ghead">{group.title}<span class="ag-count">{group.rows.length}</span></h4>
        {/if}
        <ul class="ag-rows">
          {#each group.rows as row (row.key)}
            <li class="ag-row" class:copying={copying === row.key}>
              <Workflow size={14} class="ag-icon" aria-hidden="true" />
              <span class="ag-label">
                <span class="ag-name-text">{row.label}</span>
                <!-- Under a zone heading the trigger line would repeat the heading; say who plays it. -->
                <span class="ag-sub">{sort === 'zone' && group.zone ? usage(row.placements) : `${row.sub} · ${usage(row.placements)}`}</span>
              </span>
              {#if copying === row.key}
                <span class="ag-name">
                  <CommitInput
                    value={copyNameFor(row.label)}
                    ariaLabel="Name for the copy"
                    onCommit={(name) => commitCopy(row.key, name)}
                    onCancel={() => (copying = null)}
                  />
                </span>
              {:else}
                {#if row.duplicate}<span class="ag-tag dup">duplicate</span>{/if}
                {#if row.inSection}<span class="ag-tag">in section</span>{/if}
                <IconButton
                  icon={CopyPlus}
                  label="Add as a copy — independent graph (default)"
                  disabled={!canPlace}
                  onclick={() => ((copying = row.key), (naming = false))}
                />
                <IconButton
                  icon={Link2}
                  label={row.inSection ? 'Already linked in this section' : 'Add as a link — one graph, shared edits'}
                  disabled={row.inSection || !canPlace}
                  onclick={() => link(row.key)}
                />
                <IconButton
                  icon={Trash2}
                  label={`Delete “${row.label}” everywhere`}
                  disabled={!store.canEdit}
                  onclick={() => remove(row.key, row.placements)}
                />
              {/if}
            </li>
          {/each}
          {#if group.zone && group.rows.length === 0}
            {@const zone = group.zone}
            <li class="ag-row ag-empty">
              <span class="ag-label"><span class="ag-sub">No graph fires from this zone yet</span></span>
              <button type="button" class="ag-new" disabled={!canPlace} title={canPlace ? `Create a graph for ${group.title}` : blockReason} onclick={() => createForZone(zone)}>
                <Plus size={14} aria-hidden="true" />
                Create
              </button>
            </li>
          {/if}
        </ul>
      </section>
    {:else}
      <p class="ag-none">No graph matches “{query}”.</p>
    {/each}
  </div>
</Dialog>

<ConfirmDialog
  open={deleting !== null}
  layer={2}
  title="Delete {deleting ? store.graphLabel(deleting) : ''}?"
  message="Sections play this graph. Deleting it removes it from every section of every song, not just this one."
  confirmLabel="Delete everywhere"
  danger
  onConfirm={() => deleting && store.deleteGraph(deleting)}
  onClose={() => (deleting = null)}
/>

<ConfirmDialog
  open={confirmingDedupe}
  layer={2}
  title="Remove {redundant} duplicate {redundant === 1 ? 'graph' : 'graphs'}?"
  message="Each is an exact copy of another graph, and no section plays it. One copy of every graph stays, and every graph a section plays stays. Undo brings them back."
  confirmLabel="Remove duplicates"
  danger
  onConfirm={() => store.removeDuplicateGraphs()}
  onClose={() => (confirmingDedupe = false)}
/>

<style>
  :global(.dlg-addgraph) {
    width: min(520px, 92vw);
  }
  .ag-tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .ag-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .ag-spacer {
    flex: 1;
  }
  .ag-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .ag-reason {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: 1.4;
    border-bottom: 1px solid var(--border-faint);
  }
  .ag-bar :global(.search) {
    flex: 1;
  }
  .ag-new {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border-style: dashed;
    color: var(--text-muted);
  }
  .ag-new:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  .ag-new:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .ag-name {
    display: block;
    width: 150px;
    flex: none;
  }
  .ag-list {
    margin: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    overflow: auto;
  }
  .ag-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* Zone heading: sticky, so a long zone never scrolls its name away. */
  .ag-ghead {
    position: sticky;
    top: calc(-1 * var(--space-2));
    z-index: 1;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    padding: var(--space-1) var(--space-1);
    background: var(--surface);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .ag-count {
    color: var(--text-faint);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .ag-empty {
    border-style: dashed;
    background: transparent;
  }
  .ag-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
  .ag-row:hover {
    border-color: var(--border-strong);
  }
  .ag-row.copying {
    border-color: var(--accent-dim);
  }
  .ag-row :global(.ag-icon) {
    flex: none;
    color: var(--accent);
  }
  .ag-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .ag-name-text {
    font-size: var(--text-sm);
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ag-sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ag-tag {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .ag-tag.dup {
    color: var(--warn);
  }
  .ag-none {
    padding: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
