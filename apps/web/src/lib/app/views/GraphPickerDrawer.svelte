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
  import Link2 from '@lucide/svelte/icons/link-2';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';

  let {
    store,
    section,
    onCopy,
    onLink,
    onCreate,
    onClose,
  }: {
    store: TriggerLab;
    /** The section awaiting a graph, or null when the picker is closed. */
    section: SetlistSection | null;
    onCopy: (graphKey: string) => void;
    onLink: (graphKey: string) => void;
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
        <div class="picker-item" class:in-section={inSection}>
          <Workflow size={14} aria-hidden="true" />
          <span class="picker-label">
            <span>{g.label}</span>
            <span class="picker-sub">{sourceSub(g.key)}</span>
          </span>
          {#if inSection}
            <span class="picker-tag">in section</span>
          {:else}
            <button class="picker-action primary" type="button" aria-label={`Add ${g.label} as a copy`} onclick={() => onCopy(g.key)}>
              <CopyPlus size={13} aria-hidden="true" /> Copy
            </button>
            <button class="picker-action" type="button" aria-label={`Link ${g.label} to this section`} onclick={() => onLink(g.key)}>
              <Link2 size={13} aria-hidden="true" /> Link
            </button>
          {/if}
        </div>
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
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    text-align: left;
    color: var(--text);
  }
  .picker-item.in-section { opacity: 0.55; }
  .picker-item:hover {
    border-color: var(--border-accent);
    color: var(--ink);
  }
  .picker-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 24px;
    padding: 0 var(--space-1_5);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-control-sm);
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .picker-action:hover {
    border-color: var(--border-accent);
    color: var(--ink);
  }
  .picker-action.primary {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
    color: var(--accent);
  }
  .picker-item.new {
    background: var(--surface-inset);
    border-style: dashed;
    border-color: var(--border-strong);
    color: var(--text-muted);
  }
  .picker-item.new:hover {
    border-color: var(--border-accent);
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
