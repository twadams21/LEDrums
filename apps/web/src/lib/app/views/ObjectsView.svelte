<script lang="ts">
  /* Objects — a master-detail index of every authored object. Left: the object TYPES
     (Songs · Effects · Graphs · Presets), styled like the view rail; right: the objects of the
     selected type, each row carrying per-type CRUD via the right-click ContextMenu (plus hover
     quick-actions), wired to the store's tested CRUD. Songs activate on click; graphs open in the
     Trigger editor; effects are rename/duplicate only (foundational — never deletable); presets
     add delete, gated to an unused, non-`:default` preset (the store enforces the same guard, and
     `objects-view.ts` mirrors it into `deletable` so the menu disables Delete in lockstep). */
  import type { Component } from 'svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { type ObjectTypeId, type PresetRow, effectRows, graphRows, presetRows } from './objects-view';
  import { describeTriggerSource } from '../trigger-source-label';
  import CommitInput from '../../ui/CommitInput.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import SquarePen from '@lucide/svelte/icons/square-pen';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Workflow from '@lucide/svelte/icons/workflow';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  let type = $state<ObjectTypeId>('songs');
  let editingId = $state<string | null>(null); // the row being renamed (song.id / effect.id / preset.id / graph key)
  let selectedId = $state<string | null>(null); // local highlight for effect/preset rows (no nav target of their own)

  function setType(t: ObjectTypeId): void {
    if (t === type) return;
    type = t;
    editingId = null;
    selectedId = null;
  }

  // derived row lists — recompute as the underlying store collections change (presetRows reads
  // presetUsageCount, which depends on `graphs`, so usage stays live).
  const songs = $derived(store.songs);
  const effects = $derived(effectRows(store.effects, store.presets));
  const graphs = $derived(graphRows(store.graphLibrary));
  const presets = $derived(presetRows(store.presets, store.effects, (id) => store.presetUsageCount(id)));

  const TYPES: Array<{ id: ObjectTypeId; label: string; icon: Component }> = [
    { id: 'songs', label: 'Songs', icon: ListMusic },
    { id: 'effects', label: 'Effects', icon: Sparkles },
    { id: 'graphs', label: 'Graphs', icon: Workflow },
    { id: 'presets', label: 'Presets', icon: Bookmark },
  ];
  const countOf = (id: ObjectTypeId): number =>
    id === 'songs'
      ? songs.length
      : id === 'effects'
        ? effects.length
        : id === 'graphs'
          ? graphs.length
          : presets.length;
  const activeType = $derived(TYPES.find((t) => t.id === type)!);
  const HeadIcon = $derived(activeType.icon);

  /** The graph's source sub line (e.g. "Kick · center", "MIDI note 38"). */
  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }

  /** Open a graph in the Trigger editor (it need not belong to a section). */
  function openGraph(key: string): void {
    store.selectedPadKey = key;
    shell.setView('trigger');
  }

  function removeSong(id: string): void {
    if (editingId === id) editingId = null;
    store.removeSong(id);
  }
  function removeGraph(key: string): void {
    if (editingId === key) editingId = null;
    store.deleteGraph(key);
  }

  // --- per-type right-click verbs (the required CRUD surface) ----------------
  function songActions(id: string): ContextMenuAction[] {
    return [
      { label: 'Activate', icon: Play, onSelect: () => store.setActiveSong(id) },
      { label: 'Rename', icon: Pencil, onSelect: () => (editingId = id) },
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateSong(id) },
      { label: 'Delete', icon: Trash2, danger: true, disabled: store.songs.length <= 1, onSelect: () => removeSong(id) },
    ];
  }
  function graphActions(key: string): ContextMenuAction[] {
    return [
      { label: 'Open', icon: SquarePen, onSelect: () => openGraph(key) },
      { label: 'Rename', icon: Pencil, onSelect: () => (editingId = key) },
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateGraph(key) },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => removeGraph(key) },
    ];
  }
  function effectActions(id: string): ContextMenuAction[] {
    // effects are foundational — rename + duplicate only, never delete.
    return [
      { label: 'Rename', icon: Pencil, onSelect: () => (editingId = id) },
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateEffect(id) },
    ];
  }
  function presetActions(row: PresetRow): ContextMenuAction[] {
    return [
      { label: 'Rename', icon: Pencil, onSelect: () => (editingId = row.id) },
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicatePreset(row.id) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        disabled: !row.deletable, // unused AND not a live effect's `:default`
        onSelect: () => store.deletePreset(row.id),
      },
    ];
  }
</script>

<div class="objects-view">
  <nav class="typerail" aria-label="Object types">
    <Eyebrow icon={Boxes}>Objects</Eyebrow>
    {#each TYPES as t (t.id)}
      {@const I = t.icon}
      <button
        class="typeitem"
        class:active={type === t.id}
        aria-pressed={type === t.id}
        onclick={() => setType(t.id)}
      >
        <I size={16} aria-hidden="true" />
        <span class="typelabel">{t.label}</span>
        <span class="typecount">{countOf(t.id)}</span>
      </button>
    {/each}
  </nav>

  <section class="detail">
    <header class="detail-head">
      <Eyebrow icon={HeadIcon}>{activeType.label}</Eyebrow>
      <span class="detail-count">{countOf(type)}</span>
    </header>

    <div class="objlist">
      {#if type === 'songs'}
        {#each songs as song (song.id)}
          {@const active = store.activeSongId === song.id}
          <ContextMenu actions={songActions(song.id)}>
            <div class="objrow" class:active>
              {#if editingId === song.id}
                <div class="row-edit">
                  <CommitInput
                    value={song.name}
                    ariaLabel="Song name"
                    onCommit={(name) => {
                      store.renameSong(song.id, name);
                      editingId = null;
                    }}
                    onCancel={() => (editingId = null)}
                  />
                </div>
              {:else}
                <button
                  class="row-main"
                  onclick={() => store.setActiveSong(song.id)}
                  ondblclick={() => (editingId = song.id)}
                  title="Activate · double-click to rename"
                >
                  <ListMusic size={14} aria-hidden="true" />
                  <span class="row-text">
                    <span class="row-name">{song.name}</span>
                    <span class="row-sub">{song.sections.length} {song.sections.length === 1 ? 'section' : 'sections'}</span>
                  </span>
                  {#if active}<span class="dot" title="Active song" aria-hidden="true"></span>{/if}
                </button>
                <div class="row-actions">
                  <IconButton icon={Pencil} label="Rename song" size={13} onclick={() => (editingId = song.id)} />
                  <IconButton icon={CopyPlus} label="Duplicate song" size={13} onclick={() => store.duplicateSong(song.id)} />
                  <IconButton
                    icon={Trash2}
                    label="Delete song"
                    size={13}
                    disabled={store.songs.length <= 1}
                    onclick={() => removeSong(song.id)}
                  />
                </div>
              {/if}
            </div>
          </ContextMenu>
        {/each}
        {#if songs.length === 0}<p class="empty">No songs yet.</p>{/if}
      {:else if type === 'effects'}
        {#each effects as e (e.id)}
          {@const active = selectedId === e.id}
          <ContextMenu actions={effectActions(e.id)}>
            <div class="objrow" class:active>
              {#if editingId === e.id}
                <div class="row-edit">
                  <CommitInput
                    value={e.name}
                    ariaLabel="Effect name"
                    onCommit={(name) => {
                      store.renameEffect(e.id, name);
                      editingId = null;
                    }}
                    onCancel={() => (editingId = null)}
                  />
                </div>
              {:else}
                <button
                  class="row-main"
                  onclick={() => (selectedId = e.id)}
                  ondblclick={() => (editingId = e.id)}
                  title="Right-click for actions · double-click to rename"
                >
                  <Sparkles size={14} aria-hidden="true" />
                  <span class="row-text">
                    <span class="row-name">{e.name}</span>
                    <span class="row-sub">{e.presetCount} {e.presetCount === 1 ? 'preset' : 'presets'}</span>
                  </span>
                </button>
                <div class="row-actions">
                  <IconButton icon={Pencil} label="Rename effect" size={13} onclick={() => (editingId = e.id)} />
                  <IconButton icon={CopyPlus} label="Duplicate effect" size={13} onclick={() => store.duplicateEffect(e.id)} />
                </div>
              {/if}
            </div>
          </ContextMenu>
        {/each}
        {#if effects.length === 0}<p class="empty">No effects yet.</p>{/if}
      {:else if type === 'graphs'}
        {#each graphs as g (g.key)}
          {@const active = store.selectedPadKey === g.key}
          <ContextMenu actions={graphActions(g.key)}>
            <div class="objrow" class:active>
              {#if editingId === g.key}
                <div class="row-edit">
                  <CommitInput
                    value={store.graphLabel(g.key)}
                    ariaLabel="Graph name"
                    onCommit={(name) => {
                      store.renameGraph(g.key, name);
                      editingId = null;
                    }}
                    onCancel={() => (editingId = null)}
                  />
                </div>
              {:else}
                <button class="row-main" onclick={() => openGraph(g.key)} title="Open {g.label}">
                  <Workflow size={14} aria-hidden="true" />
                  <span class="row-text">
                    <span class="row-name">{g.label}</span>
                    <span class="row-sub">{sourceSub(g.key)}</span>
                  </span>
                </button>
                <div class="row-actions">
                  <IconButton icon={Pencil} label="Rename graph" size={13} onclick={() => (editingId = g.key)} />
                  <IconButton icon={CopyPlus} label="Duplicate graph" size={13} onclick={() => store.duplicateGraph(g.key)} />
                  <IconButton icon={Trash2} label="Delete graph" size={13} onclick={() => removeGraph(g.key)} />
                </div>
              {/if}
            </div>
          </ContextMenu>
        {/each}
        {#if graphs.length === 0}<p class="empty">No graphs yet.</p>{/if}
      {:else}
        {#each presets as p (p.id)}
          {@const active = selectedId === p.id}
          <ContextMenu actions={presetActions(p)}>
            <div class="objrow" class:active>
              {#if editingId === p.id}
                <div class="row-edit">
                  <CommitInput
                    value={p.name}
                    ariaLabel="Preset name"
                    onCommit={(name) => {
                      store.renamePreset(p.id, name);
                      editingId = null;
                    }}
                    onCancel={() => (editingId = null)}
                  />
                </div>
              {:else}
                <button
                  class="row-main"
                  onclick={() => (selectedId = p.id)}
                  ondblclick={() => (editingId = p.id)}
                  title="Right-click for actions · double-click to rename"
                >
                  <Bookmark size={14} aria-hidden="true" />
                  <span class="row-text">
                    <span class="row-name">{p.name}</span>
                    <span class="row-sub">
                      {p.effectName} · {p.usage === 0 ? 'unused' : `used ${p.usage}×`}{p.isDefault ? ' · default' : ''}
                    </span>
                  </span>
                </button>
                <div class="row-actions">
                  <IconButton icon={Pencil} label="Rename preset" size={13} onclick={() => (editingId = p.id)} />
                  <IconButton icon={CopyPlus} label="Duplicate preset" size={13} onclick={() => store.duplicatePreset(p.id)} />
                  <IconButton
                    icon={Trash2}
                    label={p.deletable ? 'Delete preset' : 'In use — can’t delete'}
                    size={13}
                    disabled={!p.deletable}
                    onclick={() => store.deletePreset(p.id)}
                  />
                </div>
              {/if}
            </div>
          </ContextMenu>
        {/each}
        {#if presets.length === 0}<p class="empty">No presets yet.</p>{/if}
      {/if}
    </div>
  </section>
</div>

<style>
  .objects-view {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr);
    gap: var(--space-3);
    height: 100%;
    min-height: 0;
    -webkit-font-smoothing: antialiased;
  }
  .typerail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    min-height: 0;
    overflow: auto;
  }
  .typerail :global(.eyebrow) {
    margin-bottom: var(--space-1);
  }
  .typeitem {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: left;
  }
  .typeitem:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .typeitem.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  .typeitem.active :global(svg) {
    color: var(--accent);
  }
  .typeitem :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .typelabel {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .typecount {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .detail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .detail-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }
  .detail-count {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .objlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: auto;
    padding: 0 var(--space-3) var(--space-3);
  }
  .objrow {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 40px;
    padding: 2px 4px 2px 2px;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }
  .objrow.active {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
    background: var(--accent-soft);
  }
  /* inline-rename slot — fills the row; CommitInput draws its own field */
  .row-edit {
    display: flex;
    flex: 1;
    min-width: 0;
    padding: 2px;
  }
  .row-main {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: none;
    text-align: left;
    color: var(--text);
  }
  .row-main :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .objrow.active .row-main :global(svg) {
    color: var(--accent);
  }
  .row-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--ink);
  }
  .row-sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .row-actions {
    display: none;
    align-items: center;
    flex: none;
  }
  .objrow:hover .row-actions {
    display: inline-flex;
  }
  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .objrow {
      transition: none;
    }
  }
</style>
