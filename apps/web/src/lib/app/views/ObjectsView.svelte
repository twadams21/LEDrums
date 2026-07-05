<script lang="ts">
  /* Objects — a master-detail index of every authored object. Left rail: the object TYPES
     (Songs · Effects · Graphs · Presets); right: the objects of the selected type, each row
     a per-type sub-component (SongRow / EffectRow / GraphRow / PresetRow) carrying its own
     CRUD via the right-click ContextMenu + hover quick-actions. Songs activate on click;
     graphs open in the Trigger editor; effects are rename/duplicate only (foundational);
     presets add delete, gated to an unused, non-`:default` preset (the row trusts the
     view-model's `deletable`, which mirrors the store guard). Layout via the MasterDetail
     primitive; rows via EditableRow. */
  import type { Component } from 'svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import {
    type ObjectTypeId,
    canvasSceneRows,
    effectRows,
    graphRows,
    librarySongRows,
    presetRows,
    showSongRows,
  } from './objects-view';
  import MasterDetail from '../../ui/MasterDetail.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import SongRow from './SongRow.svelte';
  import LibraryRefRow from './LibraryRefRow.svelte';
  import LibrarySongRow from './LibrarySongRow.svelte';
  import EffectRow from './EffectRow.svelte';
  import GraphRow from './GraphRow.svelte';
  import PresetRow from './PresetRow.svelte';
  import CanvasSceneRow from './CanvasSceneRow.svelte';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Shapes from '@lucide/svelte/icons/shapes';
  import Plus from '@lucide/svelte/icons/plus';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import LibraryBig from '@lucide/svelte/icons/library-big';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Workflow from '@lucide/svelte/icons/workflow';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  let type = $state<ObjectTypeId>('songs');
  let selectedId = $state<string | null>(null); // local highlight for effect/preset rows (no nav target of their own)

  // derived row lists — recompute as the underlying store collections change (presetRows reads
  // presetUsageCount, which depends on `graphs`, so usage stays live).
  // Songs split by SOURCE (S42): the show's setlist — local authored songs + resolved library
  // references — vs the shared Song Library pool. `showSongRows` tags the references (the tail of
  // the resolved list); local songs render as editable SongRows, references as LibraryRefRows.
  const localSongs = $derived(store.songs);
  const refSongs = $derived(
    showSongRows(store.songs, store.resolvedSongs).filter((r) => r.origin === 'reference'),
  );
  const setlistCount = $derived(store.resolvedSongs.length);
  const librarySongs = $derived(librarySongRows(store.songLibraryList, store.songRefs));
  const effects = $derived(effectRows(store.effects, store.presets));
  const graphs = $derived(graphRows(store.graphLibrary));
  const presets = $derived(presetRows(store.presets, store.effects, (id) => store.presetUsageCount(id)));
  const canvasScenes = $derived(canvasSceneRows(store.canvasScenes));

  const TYPES: Array<{ id: ObjectTypeId; label: string; icon: Component }> = [
    { id: 'songs', label: 'Songs', icon: ListMusic },
    { id: 'library', label: 'Song Library', icon: LibraryBig },
    { id: 'effects', label: 'Effects', icon: Sparkles },
    { id: 'graphs', label: 'Graphs', icon: Workflow },
    { id: 'presets', label: 'Presets', icon: Bookmark },
    { id: 'canvas-scenes', label: 'Canvas Scenes', icon: Shapes },
  ];
  const countOf = (id: ObjectTypeId): number =>
    id === 'songs'
      ? setlistCount
      : id === 'library'
        ? librarySongs.length
        : id === 'effects'
          ? effects.length
          : id === 'graphs'
            ? graphs.length
            : id === 'canvas-scenes'
              ? canvasScenes.length
              : presets.length;
  const activeType = $derived(TYPES.find((t) => t.id === type)!);
  const HeadIcon = $derived(activeType.icon);

  /** Select a type in the rail; reset the local effect/preset highlight on a real change. */
  function selectType(select: (t: ObjectTypeId) => void, t: ObjectTypeId): void {
    if (t !== type) selectedId = null;
    select(t);
  }

  /** Open a graph in the Trigger editor (it need not belong to a section). */
  function openGraph(key: string): void {
    store.selectedPadKey = key;
    shell.setView('trigger');
  }
</script>

<MasterDetail bind:selected={type} railLabel="Object types" railWidth="210px">
  {#snippet railHeader()}
    <PanelHeader icon={Boxes} title="Objects" />
  {/snippet}
  {#snippet master({ selected, select })}
    {#each TYPES as t (t.id)}
      <ListItem
        icon={t.icon}
        label={t.label}
        active={selected === t.id}
        onclick={() => selectType(select, t.id)}
      >
        {#snippet trailing()}<span class="typecount">{countOf(t.id)}</span>{/snippet}
      </ListItem>
    {/each}
  {/snippet}

  {#snippet detail()}
    <PanelHeader icon={HeadIcon} title={activeType.label}>
      <span class="detail-count">{countOf(type)}</span>
      {#if type === 'songs' && store.canEdit}
        <IconButton
          icon={ClipboardPaste}
          label="Paste song from clipboard"
          size={14}
          onclick={() => store.openSongPaste()}
        />
      {/if}
      {#if type === 'graphs' && store.canEdit}
        <IconButton
          icon={ClipboardPaste}
          label="Paste graph from clipboard"
          size={14}
          onclick={() => void store.pasteGraphFromClipboard()}
        />
      {/if}
      {#if type === 'canvas-scenes' && store.canEdit}
        <IconButton
          icon={Plus}
          label="New canvas scene"
          size={14}
          onclick={() => (selectedId = store.createCanvasScene())}
        />
      {/if}
    </PanelHeader>

    <div class="objlist">
      {#if type === 'songs'}
        {#each localSongs as song (song.id)}
          <SongRow {store} {song} />
        {/each}
        {#each refSongs as row (row.id)}
          <LibraryRefRow {store} {row} />
        {/each}
      {:else if type === 'library'}
        {#each librarySongs as row (row.id)}
          <LibrarySongRow {store} {row} />
        {/each}
        {#if librarySongs.length === 0}
          <p class="empty">No saved songs yet. Save a song to the library to reuse it across shows.</p>
        {/if}
      {:else if type === 'effects'}
        {#each effects as effect (effect.id)}
          <EffectRow {store} {effect} active={selectedId === effect.id} onSelect={() => (selectedId = effect.id)} />
        {/each}
        {#if effects.length === 0}<p class="empty">No effects yet.</p>{/if}
      {:else if type === 'graphs'}
        {#each graphs as graph (graph.key)}
          <GraphRow {store} {graph} active={store.selectedPadKey === graph.key} onOpen={openGraph} />
        {/each}
        {#if graphs.length === 0}<p class="empty">No graphs yet.</p>{/if}
      {:else if type === 'canvas-scenes'}
        {#each canvasScenes as scene (scene.id)}
          <CanvasSceneRow {store} {scene} active={selectedId === scene.id} onSelect={() => (selectedId = scene.id)} />
        {/each}
        {#if canvasScenes.length === 0}
          <p class="empty">No canvas scenes yet. Create one to author canvas-backed play nodes.</p>
        {/if}
      {:else}
        {#each presets as preset (preset.id)}
          <PresetRow {store} {preset} active={selectedId === preset.id} onSelect={() => (selectedId = preset.id)} />
        {/each}
        {#if presets.length === 0}<p class="empty">No presets yet.</p>{/if}
      {/if}
    </div>
  {/snippet}
</MasterDetail>

<style>
  .typecount {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
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
    flex: 1;
    overflow: auto;
    padding: var(--space-3);
  }
  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
