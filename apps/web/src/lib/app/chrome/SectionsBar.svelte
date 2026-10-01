<script lang="ts">
  /* Sections bar (tabbed chrome row 3): the active song's sections as a chip row,
     the active section raised. Firing a chip is the same setActiveSection recall
     the Perform pads and ←/→ keys drive. The add affordance stays visible while
     gated so presence resolution cannot make the compact chrome jump. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import ContextMenu from '../../ui/ContextMenu.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import { sectionActions } from '../section-actions';
  import IconButton from '../../ui/IconButton.svelte';
  import NavArrow from '../../ui/NavArrow.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import { NO_ACTIVE_SONG_REASON, REFERENCE_SONG_REASON, VIEWING_REASON } from './edit-gate';
  import { BIND_INVITE, globalControlBindingSummary } from '../global-control-labels';
  import { globalControlDef, type GlobalControlAction } from '@ledrums/core';
  import type { MappableSpec } from '../../trigger-lab/map-api';
  import { mappable } from '../map-mode/mappable.svelte';

  let { store }: { store: TriggerLab } = $props();

  let editingId = $state<string | null>(null);
  function startRename(id: string): void {
    if (store.canEditActiveSong) requestAnimationFrame(() => (editingId = id));
  }

  const sections = $derived(store.activeSongById?.sections ?? []);
  // Explain the specific unavailable target before the generic viewer gate: it tells the user
  // whether they need to detach a reference or take over an editable local song.
  const addBlockedReason = $derived(
    !store.activeLocalSong
      ? store.activeSongById
        ? REFERENCE_SONG_REASON
        : NO_ACTIVE_SONG_REASON
      : !store.canEdit
        ? VIEWING_REASON
        : undefined,
  );
  const prevBinding = $derived(globalControlBindingSummary(store.globalControls.prevSection));
  const nextBinding = $derived(globalControlBindingSummary(store.globalControls.nextSection));

  /** MIDI-map: a nav arrow maps its global control (written to Settings' bindings). */
  const globalMap = (action: GlobalControlAction): MappableSpec => ({
    target: { kind: 'globalControl', action },
    kind: 'button',
    label: globalControlDef(action).label,
  });

  /** MIDI-map: a chip recalls its section of the active song. */
  const songId = $derived(store.activeSongById?.id);
</script>

<div class="bar" role="navigation" aria-label="Sections">
  <span class="rowlabel"><LayoutGrid size={13} aria-hidden="true" /> Sections</span>
  <span class="nav" {@attach mappable(globalMap('prevSection'))}>
    <NavArrow direction="prev" unit="section" disabled={!store.canStepSetlist('section', -1)} binding={prevBinding} bindingInvite={BIND_INVITE} onclick={() => store.stepSetlist('section', -1)} />
  </span>
  <div class="chips">
    {#if sections.length === 0}
      <span class="none">No sections in this song</span>
    {/if}
    {#each sections as sec (sec.id)}
      {#if editingId === sec.id}
        <span class="chip-edit">
          <CommitInput value={sec.name} ariaLabel="Section name" onCommit={(name) => { editingId = null; store.renameSection(sec.id, name); }} onCancel={() => (editingId = null)} />
        </span>
      {:else}
      <ContextMenu actions={sectionActions(store, sec.id, () => startRename(sec.id))}>

      <button
        type="button"
        class="chip"
        class:on={store.activeSectionId === sec.id}
        aria-current={store.activeSectionId === sec.id ? 'true' : undefined}
        {@attach mappable({ target: { kind: 'recallSection', sectionId: sec.id, songId }, kind: 'button', label: `Section · ${sec.name}` })}
        onclick={() => store.setActiveSection(sec.id)}
        ondblclick={() => startRename(sec.id)}
      >
        {sec.name}<span class="cnt">{sec.graphs.length}</span>
      </button>
      </ContextMenu>
      {/if}
    {/each}
    <IconButton
      icon={Plus}
      label="Add section"
      size={13}
      disabled={Boolean(addBlockedReason)}
      disabledReason={addBlockedReason}
      onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}
    />
  </div>
  <span class="nav" {@attach mappable(globalMap('nextSection'))}>
    <NavArrow direction="next" unit="section" disabled={!store.canStepSetlist('section', 1)} binding={nextBinding} bindingInvite={BIND_INVITE} onclick={() => store.stepSetlist('section', 1)} />
  </span>
</div>

<style>
  .chip-edit { flex: 0 0 150px; }
  .nav {
    display: inline-flex;
    flex: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
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
    scrollbar-width: none;
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
    transition-property: color, background-color;
    transition-duration: var(--dur-150);
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
</style>
