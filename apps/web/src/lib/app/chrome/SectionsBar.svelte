<script lang="ts">
  /* Sections bar (tabbed chrome row 3): the active song's sections as a chip row,
     the active section raised. Firing a chip is the same setActiveSection recall
     the Perform pads and ←/→ keys drive. Editors also get the add-section
     affordance here (the twin of SongsBar's add-song), so a section can be made
     without first opening the Sections view; the new section becomes active. A
     viewer sees it disabled with the reason, never hidden (edit-gate.ts). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import { NO_SONG_REASON, VIEWING_REASON } from './edit-gate';

  let { store }: { store: TriggerLab } = $props();

  const sections = $derived(store.activeSong?.sections ?? []);
  // Why "add section" is dead, in precedence order: read-only beats empty setlist.
  const addBlocked = $derived(!store.canEdit ? VIEWING_REASON : !store.activeSong ? NO_SONG_REASON : null);
</script>

<div class="bar" role="navigation" aria-label="Sections">
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
        aria-current={store.activeSectionId === sec.id ? 'true' : undefined}
        onclick={() => store.setActiveSection(sec.id)}
      >
        {sec.name}<span class="cnt">{sec.graphs.length}</span>
      </button>
    {/each}
    <IconButton
      icon={Plus}
      label="Add section"
      size={13}
      disabled={!!addBlocked}
      disabledReason={addBlocked ?? undefined}
      onclick={() => store.addSongSection(`Section ${sections.length + 1}`)}
    />
  </div>
</div>

<style>
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
