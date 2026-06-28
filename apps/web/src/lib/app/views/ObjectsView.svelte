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
  import { type ObjectTypeId, effectRows, graphRows, presetRows } from './objects-view';
  import MasterDetail from '../../ui/MasterDetail.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import SongRow from './SongRow.svelte';
  import EffectRow from './EffectRow.svelte';
  import GraphRow from './GraphRow.svelte';
  import PresetRow from './PresetRow.svelte';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Workflow from '@lucide/svelte/icons/workflow';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  let type = $state<ObjectTypeId>('songs');
  let selectedId = $state<string | null>(null); // local highlight for effect/preset rows (no nav target of their own)

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
  {#snippet master({ selected, select })}
    <Eyebrow icon={Boxes}>Objects</Eyebrow>
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
    <header class="detail-head">
      <Eyebrow icon={HeadIcon}>{activeType.label}</Eyebrow>
      <span class="detail-count">{countOf(type)}</span>
    </header>

    <div class="objlist">
      {#if type === 'songs'}
        {#each songs as song (song.id)}
          <SongRow {store} {song} />
        {/each}
        {#if songs.length === 0}<p class="empty">No songs yet.</p>{/if}
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
  /* rail eyebrow spacing (mirrors the old .typerail header gap) */
  :global(.md-rail) > :global(.eyebrow) {
    margin-bottom: var(--space-1);
  }
  .typecount {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .detail-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
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
    flex: 1;
    overflow: auto;
    padding: 0 var(--space-3) var(--space-3);
  }
  .empty {
    margin: 0;
    padding: var(--space-3) var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
