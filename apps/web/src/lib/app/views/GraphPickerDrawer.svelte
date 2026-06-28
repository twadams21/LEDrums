<script lang="ts">
  /* The "add a graph" picker for a section, in a right-side Drawer. Lists every graph in the
     library (disabled when already in the section) plus a "New graph" affordance. Pure UI over
     the store + callbacks — the pending-section state lives in SectionsView. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { SetlistSection } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import Drawer from '../../ui/Drawer.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Workflow from '@lucide/svelte/icons/workflow';

  let {
    store,
    section,
    onPlace,
    onCreate,
    onClose,
  }: {
    store: TriggerLab;
    /** The section awaiting a graph, or null when the picker is closed. */
    section: SetlistSection | null;
    onPlace: (graphKey: string) => void;
    onCreate: () => void;
    onClose: () => void;
  } = $props();

  const sourceSub = (key: string): string =>
    describeTriggerSource(store.triggerSource(key), store.drums).sub;
</script>

<Drawer open={!!section} {onClose} title="Add a graph" side="right" width="320px">
  {#if section}
    <p class="picker-ctx">{section.name}</p>
    <div class="picker-list">
      <button class="picker-item new" onclick={onCreate}>
        <Plus size={14} aria-hidden="true" />
        <span>New graph</span>
        <span class="picker-tag">empty</span>
      </button>
      {#each store.graphLibrary as g (g.key)}
        {@const inSection = section.graphs.includes(g.key)}
        <button class="picker-item" disabled={inSection} onclick={() => onPlace(g.key)}>
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
</style>
