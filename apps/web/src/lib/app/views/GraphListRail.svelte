<script lang="ts">
  /* The Trigger Graph view's left rail — the ACTIVE section's flat graph list:
     section header + one selectable row per graph + a "New graph" affordance. Extracted
     from TriggerGraphView (#9 companion) so the view stays focused on the canvas. Each
     graph row is the shared `ListItem` primitive (matching the Song / Sections / Objects
     rails); selecting a row opens that graph on the canvas. */
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ListItem from '../../ui/ListItem.svelte';
  import Plus from '@lucide/svelte/icons/plus';

  let {
    title,
    graphs,
    selectedKey,
    labelFor,
    subFor,
    onOpen,
    onNew,
    canEdit = true,
  }: {
    /** Section name shown in the rail header. */
    title: string;
    /** Graph keys for the active section, or `null` when there is no active section. */
    graphs: readonly string[] | null;
    selectedKey: string | null;
    labelFor: (key: string) => string;
    subFor: (key: string) => string;
    onOpen: (key: string) => void;
    onNew: () => void;
    /** Authoring allowed (S2): a viewer can browse + open graphs but not create them. */
    canEdit?: boolean;
  } = $props();
</script>

<aside class="surface">
  <header class="shead">
    <Eyebrow>{title}</Eyebrow>
  </header>
  <div class="scroll">
    {#if graphs}
      {#each graphs as key (key)}
        <ListItem
          label={labelFor(key)}
          secondary={subFor(key)}
          active={selectedKey === key}
          onclick={() => onOpen(key)}
        />
      {/each}
      {#if graphs.length === 0}
        <p class="empty">No graphs in this section.</p>
      {/if}
      {#if canEdit}
        <button class="newgraph" type="button" onclick={onNew}>
          <Plus size={13} aria-hidden="true" /> New graph
        </button>
      {/if}
    {:else}
      <p class="empty">No active section.</p>
    {/if}
  </div>
</aside>

<style>
  .surface {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .shead {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .scroll {
    overflow: auto;
    min-height: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .newgraph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    margin-top: var(--space-1);
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    transition:
      color var(--dur-120) ease,
      border-color var(--dur-120) ease;
  }
  .newgraph:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .newgraph:active {
    scale: 0.98;
  }
  @media (prefers-reduced-motion: reduce) {
    .newgraph {
      transition: none;
    }
  }
</style>
