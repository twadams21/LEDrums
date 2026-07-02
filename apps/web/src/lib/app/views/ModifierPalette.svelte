<script lang="ts">
  /* Modifier add-palette (S32) — the second row of the Trigger graph's top-left toolbar.
     Lists EVERY registered modifier as a labelled add-button, grouped by category with a
     SegmentedControl filter. Built off core's `listModifiersByCategory()`, so a newly
     registered modifier appears here with no edit (never a hardcoded id list). A child of
     <SvelteFlow>, so it reaches the flow instance to place the new node at the visible
     canvas centre — exactly like GraphPalette. */
  import { useSvelteFlow } from '@xyflow/svelte';
  import Blend from '@lucide/svelte/icons/blend';
  import { listModifiersByCategory, type ModifierCategory } from '@ledrums/core';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';

  let {
    add,
    disabled = false,
  }: {
    /** Place a modifier node — `cx`/`cy` are the flow-space centre of the visible canvas. */
    add: (modifierId: string, cx: number, cy: number) => void;
    disabled?: boolean;
  } = $props();

  const flow = useSvelteFlow();

  // Registry-driven groups (temporal / spatial / texture / color, non-empty only).
  const groups = $derived(listModifiersByCategory());

  // Category filter — 'all' plus one segment per present category. Dynamic over the registry.
  let filter = $state<'all' | ModifierCategory>('all');
  const segments = $derived([
    { value: 'all', label: 'All' },
    ...groups.map((g) => ({ value: g.category, label: g.label })),
  ]);
  // If the active filter's category disappears (registry change), fall back to 'all'.
  $effect(() => {
    if (filter !== 'all' && !groups.some((g) => g.category === filter)) filter = 'all';
  });
  const visible = $derived(filter === 'all' ? groups : groups.filter((g) => g.category === filter));

  /** Flow-space centre of the visible canvas (falls back to the origin off-screen). */
  function addAt(e: MouseEvent, id: string): void {
    const surface = (e.currentTarget as HTMLElement).closest('.svelte-flow');
    const r = surface?.getBoundingClientRect();
    const c = flow.screenToFlowPosition(
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 },
    );
    add(id, c.x, c.y);
  }
</script>

<div class="modpalette" role="group" aria-label="Add modifier">
  <div class="head">
    <span class="palette-label">Modifiers</span>
    <SegmentedControl
      value={filter}
      options={segments}
      onChange={(v) => (filter = v as 'all' | ModifierCategory)}
      ariaLabel="Filter modifiers by category"
      {disabled}
    />
  </div>
  <div class="groups">
    {#each visible as group (group.category)}
      <div class="group">
        {#if filter === 'all'}<span class="cat">{group.label}</span>{/if}
        <div class="items">
          {#each group.modifiers as mod (mod.id)}
            <button
              class="palette-btn"
              onclick={(e) => addAt(e, mod.id)}
              title={`Add ${mod.name} modifier`}
              {disabled}
            >
              <Blend size={13} aria-hidden="true" class="palette-ico" />
              {mod.name}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .modpalette {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 100%;
    padding: var(--space-1);
    background: color-mix(in oklch, var(--surface) 86%, transparent);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    backdrop-filter: blur(4px);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: var(--space-1);
  }
  .palette-label {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cat {
    padding-left: var(--space-1);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--role-mod);
  }
  .items {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-width: 264px;
  }
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    cursor: pointer;
    transition-property: border-color, color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .palette-btn:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .palette-btn:active:not(:disabled) {
    scale: 0.96;
  }
  .palette-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .palette-btn :global(.palette-ico) {
    color: var(--role-mod);
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .palette-btn {
      transition: none;
    }
  }
</style>
