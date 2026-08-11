<script module lang="ts">
  /** `?open=` deep-link target: pre-open Settings, or Settings + the patch modal. */
  export type ProtoOpen = 'settings' | 'patch' | null;
</script>

<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). The tabbed chrome shared by variants
     B and C — the variants differ only in what Settings opens.

     Layout: three sticky header bars (view tabs · setlist songs · active song's
     sections), a full-width workspace, and a bottom bar carrying the transport +
     the status cluster that lives in the real TopBar today. The Trigger tab
     re-homes the Graphs list as a left pane (the real view's bottom GraphsDock
     is hidden via CSS from here — no production edits). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { View } from '../shell-nav';
  import type { Component } from 'svelte';
  import type { ProtoVariant } from './ProtoSwitcher.svelte';
  import { showSongRows } from '../views/objects-view';
  import ProtoGraphsRail from './ProtoGraphsRail.svelte';
  import ProtoSettingsB from './ProtoSettingsB.svelte';
  import ProtoSettingsC from './ProtoSettingsC.svelte';
  import TriggerGraphView from '../views/TriggerGraphView.svelte';
  import SectionsView from '../views/SectionsView.svelte';
  import ObjectsView from '../views/ObjectsView.svelte';
  import PerformView from '../views/PerformView.svelte';
  import Monitor from '../docks/Monitor.svelte';
  import Transport from '../chrome/Transport.svelte';
  import SaveIndicator from '../chrome/SaveIndicator.svelte';
  import ShareInfo from '../chrome/ShareInfo.svelte';
  import UpdateBadge from '../chrome/UpdateBadge.svelte';
  import OutputPill from '../chrome/OutputPill.svelte';
  import StatusBar from '../../trigger-lab/StatusBar.svelte';
  import ToastHost from '../../ui/ToastHost.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Logo from '../../ui/Logo.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import Boxes from '@lucide/svelte/icons/boxes';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Settings from '@lucide/svelte/icons/settings';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Plus from '@lucide/svelte/icons/plus';

  let {
    store,
    shell,
    variant,
    initialOpen = null,
    initialPane = null,
  }: {
    store: TriggerLab;
    shell: ShellStore;
    variant: ProtoVariant;
    initialOpen?: ProtoOpen;
    initialPane?: string | null;
  } = $props();

  // Patch is deliberately absent — it lives in Settings in this layout.
  const TABS: Array<{ id: View; label: string; icon: Component }> = [
    { id: 'perform', label: 'Perform', icon: Radio },
    { id: 'objects', label: 'Objects', icon: Boxes },
    { id: 'sections', label: 'Sections', icon: LayoutGrid },
    { id: 'trigger', label: 'Trigger Graph', icon: Workflow },
    { id: 'monitor', label: 'Monitor', icon: Terminal },
  ];

  const songRows = $derived(showSongRows(store.songs, store.resolvedSongs));
  const sections = $derived(store.activeSong?.sections ?? []);
  const showName = $derived(store.activeShow?.name ?? 'Untitled show');

  // svelte-ignore state_referenced_locally -- deep-link seed, initial value by design
  let settingsOpen = $state(initialOpen !== null);
</script>

<div class="pshell">
  <!-- Bar 1: brand · view tabs · identity + settings -->
  <header class="bar nav">
    <span class="brand"><Logo size={24} /><span class="word">LEDrums</span></span>
    <nav class="tabs" aria-label="Views">
      {#each TABS as t (t.id)}
        <button
          type="button"
          class="tab"
          class:on={shell.view === t.id}
          onclick={() => shell.setView(t.id)}
        >
          <t.icon size={14} aria-hidden="true" />
          {t.label}
        </button>
      {/each}
    </nav>
    <span class="idright">
      <span class="show" title="Active show">{showName}</span>
      <IconButton icon={Settings} label="Settings" size={15} onclick={() => (settingsOpen = true)} />
    </span>
  </header>

  <!-- Bar 2: setlist songs -->
  <div class="bar songs" role="navigation" aria-label="Setlist songs">
    <span class="rowlabel"><ListMusic size={13} aria-hidden="true" /> Setlist</span>
    <div class="chips">
      {#each songRows as row (row.id)}
        <button
          type="button"
          class="chip"
          class:on={store.activeSongId === row.id}
          onclick={() => store.setActiveSong(row.id)}
          title={row.origin === 'reference' ? `${row.name} (Library)` : row.name}
        >
          {row.name}<span class="cnt">{row.sectionCount}</span>
        </button>
      {/each}
      {#if store.canEdit}
        <IconButton icon={Plus} label="Add song" size={13} onclick={() => store.createSong()} />
      {/if}
    </div>
  </div>

  <!-- Bar 3: the active song's sections -->
  <div class="bar sections" role="navigation" aria-label="Sections">
    <span class="rowlabel"><LayoutGrid size={13} aria-hidden="true" /> Sections</span>
    <div class="chips">
      {#if sections.length === 0}
        <span class="none">No sections in this song</span>
      {/if}
      {#each sections as sec (sec.id)}
        <button
          type="button"
          class="chip"
          class:on={store.activeSectionId === sec.id}
          onclick={() => store.setActiveSection(sec.id)}
        >
          {sec.name}<span class="cnt">{sec.graphs.length}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Workspace: the selected tab, full width -->
  <main class="center">
    {#if shell.view === 'perform'}
      <PerformView {store} {shell} />
    {:else if shell.view === 'objects'}
      <ObjectsView {store} {shell} />
    {:else if shell.view === 'monitor'}
      <Monitor {store} variant="workspace" />
    {:else if shell.view === 'trigger'}
      <div class="trigger-host">
        <ProtoGraphsRail {store} {shell} />
        <div class="trigger-main">
          <TriggerGraphView {store} {shell} />
        </div>
      </div>
    {:else}
      <SectionsView {store} {shell} />
    {/if}
  </main>

  <!-- Bottom bar: transport (left) + the TopBar's status cluster (right) -->
  <footer class="bar bottom">
    <Transport {store} />
    <span class="statuses">
      <SaveIndicator {store} />
      <ShareInfo {store} />
      <UpdateBadge onOpen={() => (settingsOpen = true)} />
      <StatusBar {store} />
      <OutputPill {store} />
    </span>
  </footer>

  <ToastHost />
</div>

{#if variant === 'B'}
  <ProtoSettingsB
    {store}
    {shell}
    open={settingsOpen}
    initialPatchOpen={initialOpen === 'patch'}
    onClose={() => (settingsOpen = false)}
  />
{:else}
  <ProtoSettingsC {store} open={settingsOpen} {initialPane} onClose={() => (settingsOpen = false)} />
{/if}

<style>
  .pshell {
    --pad: var(--shell-gap);
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    gap: var(--pad);
    padding: var(--pad);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .nav {
    height: 46px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .word {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .tab.on {
    background: var(--surface-3);
    color: var(--ink);
    border-color: var(--border);
  }
  .idright {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .show {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .songs,
  .sections {
    height: 38px;
  }
  .rowlabel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .chips {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-x: auto;
  }
  .chip {
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
  .chip:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .chip.on {
    background: var(--surface-3);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .cnt {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .none {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .center {
    min-height: 0;
    min-width: 0;
  }
  /* Trigger tab: Graphs list as a LEFT pane; the real view's bottom dock is hidden
     from here (prototype containment — the production component is untouched). */
  .trigger-host {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: var(--pad);
    min-height: 0;
    height: 100%;
  }
  .trigger-main {
    min-width: 0;
    min-height: 0;
  }
  .trigger-main :global(.trigger-view) {
    grid-template-rows: minmax(0, 1fr);
  }
  .trigger-main :global(.trigger-view .graphbar) {
    display: none;
  }
  .bottom {
    height: 46px;
    justify-content: space-between;
  }
  .statuses {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
    min-width: 0;
  }
</style>
