<script lang="ts">
  /* Objects — a master-detail index of every authored object. Left rail: the object TYPES
     (Songs · Song Library · Canvas Scenes); right: the objects of the selected type, each row a
     per-type sub-component (SongRow / LibraryRefRow / LibrarySongRow / CanvasSceneRow) carrying
     its own CRUD via the right-click ContextMenu + hover quick-actions. Songs activate on click
     and their sub-line counts sections + Effects. The graph-era Effects / Graphs / Presets types
     are gone (effect chains S06c): Effects live in each section's grid now. Layout via the
     MasterDetail primitive; rows via EditableRow. */
  import type { Component } from 'svelte';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { type ObjectTypeId, canvasSceneRows, librarySongRows, showSongRows } from './objects-view';
  import MasterDetail from '../../ui/MasterDetail.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import SongRow from './SongRow.svelte';
  import LibraryRefRow from './LibraryRefRow.svelte';
  import LibrarySongRow from './LibrarySongRow.svelte';
  import CanvasSceneRow from './CanvasSceneRow.svelte';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Shapes from '@lucide/svelte/icons/shapes';
  import Plus from '@lucide/svelte/icons/plus';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import LibraryBig from '@lucide/svelte/icons/library-big';

  // `shell` is part of every editor view's mount contract (AuthorShell passes it); this view
  // does not navigate.
  let { store }: { store: TriggerLab; shell: ShellStore } = $props();

  let type = $state<ObjectTypeId>('songs');
  let selectedId = $state<string | null>(null); // local highlight for canvas-scene rows (no nav target of their own)

  // Songs split by SOURCE (S42): the show's setlist — local authored songs + resolved library
  // references — vs the shared Song Library pool. `showSongRows` tags the references (the tail of
  // the resolved list); local songs render as editable SongRows, references as LibraryRefRows.
  const localSongs = $derived(store.songs);
  const refSongs = $derived(
    showSongRows(store.songs, store.resolvedSongs).filter((r) => r.origin === 'reference'),
  );
  const setlistCount = $derived(store.resolvedSongs.length);
  const librarySongs = $derived(librarySongRows(store.songLibraryList, store.songRefs));
  // Authored scenes (editable, live in the show doc) + the core built-in library
  // (read-only templates — duplicate to customise; shadowed built-ins are filtered out).
  const canvasScenes = $derived(canvasSceneRows(store.canvasScenes));
  const builtinScenes = $derived(
    canvasSceneRows(store.allCanvasScenes.filter((s) => store.isBuiltinCanvasScene(s.id)), true),
  );

  const TYPES: Array<{ id: ObjectTypeId; label: string; icon: Component }> = [
    { id: 'songs', label: 'Songs', icon: ListMusic },
    { id: 'library', label: 'Song Library', icon: LibraryBig },
    { id: 'canvas-scenes', label: 'Canvas Scenes', icon: Shapes },
  ];
  const countOf = (id: ObjectTypeId): number =>
    id === 'songs' ? setlistCount : id === 'library' ? librarySongs.length : canvasScenes.length + builtinScenes.length;
  const activeType = $derived(TYPES.find((t) => t.id === type)!);
  const HeadIcon = $derived(activeType.icon);

  /** Select a type in the rail; reset the local row highlight on a real change. */
  function selectType(select: (t: ObjectTypeId) => void, t: ObjectTypeId): void {
    if (t !== type) selectedId = null;
    select(t);
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
      {:else}
        {#each canvasScenes as scene (scene.id)}
          <CanvasSceneRow {store} {scene} active={selectedId === scene.id} onSelect={() => (selectedId = scene.id)} />
        {/each}
        {#if canvasScenes.length === 0}
          <p class="empty">No authored scenes yet. Create one, or duplicate a built-in below to customise it.</p>
        {/if}
        {#if builtinScenes.length}
          <p class="grouplabel">Built-in library</p>
          {#each builtinScenes as scene (scene.id)}
            <CanvasSceneRow {store} {scene} active={selectedId === scene.id} onSelect={() => (selectedId = scene.id)} />
          {/each}
        {/if}
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
  .grouplabel {
    margin: 0;
    padding: var(--space-3) var(--space-2) var(--space-1);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
</style>
