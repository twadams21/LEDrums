<script lang="ts">
  /* "+ Add graph" — the Trigger rail's picker (#177). A Dialog over the graph library with a
     filter box: every existing graph can be added to the active section as a LINK (the same
     key in a second place — reuse by reference, badged on the card) or as a COPY (duplicate
     under a name you give), and the same modal carries the brand-new-graph form. Thin over
     tested store verbs (addGraphToSection / duplicateGraph / renameGraph / createGraph) and
     the pure `add-graph-rows` filter; the caller opens the graph it gets back. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { SetlistSection } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import { copyNameFor, graphPickRows } from './add-graph-rows';
  import Dialog from '../../ui/Dialog.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import SearchField from '../../ui/SearchField.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Link2 from '@lucide/svelte/icons/link-2';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

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

  const rows = $derived(
    graphPickRows(
      store.graphLibrary,
      section?.graphs ?? [],
      (key) => describeTriggerSource(store.triggerSource(key), store.drums).sub,
      query,
    ),
  );

  /** Close and clear every transient affordance, so a stale name field never lingers. */
  function dismiss(): void {
    query = '';
    copying = null;
    naming = false;
    onClose();
  }

  function place(graphKey: string): void {
    if (!section) return;
    store.addGraphToSection(section.id, graphKey);
    onAdded(graphKey);
    dismiss();
  }

  function link(graphKey: string): void {
    place(graphKey);
  }

  function commitCopy(sourceKey: string, name: string): void {
    const key = store.duplicateGraph(sourceKey);
    if (!key) return;
    store.renameGraph(key, name);
    place(key);
  }

  function commitNew(name: string): void {
    place(store.createGraph(name));
  }
</script>

<Dialog {open} onClose={dismiss} title="Add graph" class="dlg-addgraph">
  <header class="ag-head">
    <Eyebrow icon={Workflow}>Add graph{section ? ` · ${section.name}` : ''}</Eyebrow>
    <span class="ag-spacer"></span>
    <IconButton icon={X} label="Close" onclick={dismiss} />
  </header>

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
      <button type="button" class="ag-new" onclick={() => ((naming = true), (copying = null))}>
        <Plus size={14} aria-hidden="true" />
        New graph
      </button>
    {/if}
  </div>

  <ul class="ag-list">
    {#each rows as row (row.key)}
      <li class="ag-row" class:copying={copying === row.key}>
        <Workflow size={14} class="ag-icon" aria-hidden="true" />
        <span class="ag-label">
          <span class="ag-name-text">{row.label}</span>
          <span class="ag-sub">{row.sub}</span>
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
          {#if row.inSection}<span class="ag-tag">in section</span>{/if}
          <IconButton
            icon={Link2}
            label={row.inSection ? 'Already linked in this section' : 'Add as a link — one graph, two places'}
            disabled={row.inSection}
            onclick={() => link(row.key)}
          />
          <IconButton
            icon={CopyPlus}
            label="Add as a copy — an independent graph"
            onclick={() => ((copying = row.key), (naming = false))}
          />
        {/if}
      </li>
    {:else}
      <li class="ag-none">No graph matches “{query}”.</li>
    {/each}
  </ul>
</Dialog>

<style>
  :global(.dlg-addgraph) {
    width: min(460px, 92vw);
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
  .ag-name {
    display: block;
    width: 150px;
    flex: none;
  }
  .ag-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: auto;
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
  .ag-none {
    padding: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
