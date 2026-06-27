<script lang="ts" generics="K extends string">
  /* Add-item palette shared by both graphs (#9) — the top-left toolbar (kind/device
     icons + tints). A child of <SvelteFlow>, so it can reach the flow instance: a
     click computes the visible canvas centre in flow-space and hands it to `add`, which
     the caller uses to place the new node (the Trigger graph adds through the store; the
     Patch graph drops a local, ephemeral device node). The caller owns any per-item
     offset so the two graphs keep their existing drop positions exactly. */
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { Component } from 'svelte';

  type PaletteItem<K extends string> = {
    key: K;
    label: string;
    icon: Component;
    /** CSS colour for the button's icon. */
    tint: string;
    /** Optional per-button title (tooltip); falls back to `Add {label}`. */
    title?: string;
  };

  let {
    items,
    add,
    ariaLabel = 'Add node',
  }: {
    items: ReadonlyArray<PaletteItem<K>>;
    /** Place a new item — `cx`/`cy` are the flow-space centre of the visible canvas. */
    add: (key: K, cx: number, cy: number) => void;
    ariaLabel?: string;
  } = $props();

  const flow = useSvelteFlow();

  /** Flow-space centre of the visible canvas (falls back to the origin off-screen). */
  function addAt(e: MouseEvent, key: K): void {
    const surface = (e.currentTarget as HTMLElement).closest('.svelte-flow');
    const r = surface?.getBoundingClientRect();
    const c = flow.screenToFlowPosition(
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 },
    );
    add(key, c.x, c.y);
  }
</script>

<div class="palette" role="toolbar" aria-label={ariaLabel}>
  <span class="palette-label">Add</span>
  {#each items as item (item.key)}
    {@const I = item.icon}
    <button
      class="palette-btn"
      onclick={(e) => addAt(e, item.key)}
      title={item.title ?? `Add ${item.label}`}
      style="--tint:{item.tint}"
    >
      <I size={14} aria-hidden="true" class="palette-ico" />
      {item.label}
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
      border-color var(--dur-120) ease,
      color var(--dur-120) ease;
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
