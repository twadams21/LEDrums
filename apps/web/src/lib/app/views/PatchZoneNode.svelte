<script lang="ts">
  /* Custom @xyflow/svelte container node for the Patch Graph v2 zones — a labelled, dashed
     holder that AUTO-FITS its member leaves (the view computes its rect; this just paints it).
     Non-draggable / non-connectable: it sits behind the leaves (low z-index) and is only a
     selection + grouping affordance. A drum SUB-zone (data.sub) reads subtler than a top holder.
     Instant hover, no motion (the locked graph-interaction contract). */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import type { PatchZoneData } from '../patch-zones';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Layers from '@lucide/svelte/icons/layers';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Zap from '@lucide/svelte/icons/zap';

  let { data, selected }: NodeProps = $props();
  const d = $derived(data as PatchZoneData);

  const ICON: Record<PatchZoneData['kind'], Component> = {
    controller: Cpu,
    kit: Layers,
    drum: Disc3,
    triggers: Zap,
  };
  const Icon = $derived(ICON[d.kind]);
</script>

<div class="zone" class:sub={d.sub} class:sel={!!selected} style="--zone-tint:{d.role}">
  <span class="zlabel"><Icon size={13} aria-hidden="true" />{d.label}</span>
  {#if d.kind === 'drum'}
    <!-- invisible anchor for the dotted Trigger → Drum reference wire (trigger sits to the right) -->
    <Handle type="target" position={Position.Right} isConnectable={false} class="ref-anchor" />
  {/if}
</div>

<style>
  .zone {
    width: 100%;
    height: 100%;
    border: 1px dashed var(--border);
    border-radius: var(--radius-3, 8px);
    background: color-mix(in oklch, var(--surface) 40%, transparent);
    box-sizing: border-box;
  }
  .zone:hover {
    border-color: var(--border-strong);
  } /* instant */
  .zone.sel {
    border-style: solid;
    border-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 15%, transparent);
  }
  .zone.sub {
    border-style: solid;
    border-color: var(--border-faint);
    background: color-mix(in oklch, var(--surface-2) 45%, transparent);
  }
  .zone.sub:hover {
    border-color: var(--border-strong);
  }
  .zone.sub.sel {
    border-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 15%, transparent);
  }
  .zlabel {
    position: absolute;
    top: -1px;
    left: -1px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 8px;
    font-size: var(--text-2xs, 0.75rem);
    font-weight: 700;
    letter-spacing: var(--tracking-label, 0.04em);
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-3, 8px) 0 var(--radius-3, 8px) 0;
    white-space: nowrap;
  }
  .zlabel :global(svg) {
    color: var(--zone-tint, var(--text-muted));
  }
  /* the reference-wire anchor is a pure edge attach point — never a visible/grabbable handle */
  .zone :global(.ref-anchor) {
    opacity: 0;
    pointer-events: none;
  }
</style>

