<script lang="ts">
  /* Add-node palette for the Trigger Graph — the top-left toolbar (kind icons +
     tints) ported from the bespoke NodeCanvas. A child of <SvelteFlow>, so it can
     reach the flow instance: a click adds the node at the viewport centre, in flow
     coords, through the store (the source of truth). */
  import { useSvelteFlow } from '@xyflow/svelte';
  import { NODE_KINDS, NODE_W, type BlockKind } from '../../trigger-lab/sim';
  import { kindIcon, kindLabel, tint } from './trigger-node-meta';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';

  let { store }: { store: TriggerLab } = $props();

  const flow = useSvelteFlow();

  /** Flow-space centre of the visible canvas (falls back to the origin off-screen). */
  function addAt(e: MouseEvent, kind: BlockKind): void {
    const surface = (e.currentTarget as HTMLElement).closest('.svelte-flow');
    const r = surface?.getBoundingClientRect();
    const centre = flow.screenToFlowPosition(
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 },
    );
    store.addNode(kind, centre.x - NODE_W / 2, centre.y - 40);
  }
</script>

<div class="palette" role="toolbar" aria-label="Add node">
  <span class="palette-label">Add</span>
  {#each NODE_KINDS as kind (kind)}
    {@const I = kindIcon[kind]}
    <button
      class="palette-btn"
      onclick={(e) => addAt(e, kind)}
      title="Add {kindLabel[kind]} node"
      style="--tint:{tint[kind]}"
    >
      <I size={14} aria-hidden="true" class="palette-ico" />
      {kindLabel[kind]}
    </button>
  {/each}
</div>

<style>
  .palette {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-width: 100%;
    padding: var(--space-1);
    background: color-mix(in oklch, var(--surface) 86%, transparent);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    backdrop-filter: blur(4px);
  }
  .palette-label {
    padding: 0 var(--space-1);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
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
    transition:
      border-color 120ms ease,
      color 120ms ease;
  }
  .palette-btn:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .palette-btn :global(.palette-ico) {
    color: var(--tint);
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .palette-btn {
      transition: none;
    }
  }
</style>
