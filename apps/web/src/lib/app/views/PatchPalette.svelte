<script lang="ts">
  /* Add-device palette for the Patch graph — matches the Trigger palette (top-left
     toolbar). Patch has no store-backed device model yet, so "add" drops a LOCAL,
     EPHEMERAL device node (a Data Line or Output) into the view's node state at the
     viewport centre; it is not persisted (the real device model is a later slice). A
     child of <SvelteFlow> so it can reach the flow instance for the centre coords. */
  import { useSvelteFlow } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import Cable from '@lucide/svelte/icons/cable';
  import Plug from '@lucide/svelte/icons/plug';
  import type { PatchStage } from '../patch-topology';

  type DeviceStage = Extract<PatchStage, 'dataline' | 'output'>;

  let { add }: { add: (stage: DeviceStage, x: number, y: number) => void } = $props();

  const flow = useSvelteFlow();

  const DEVICES: Array<{ stage: DeviceStage; label: string; icon: Component; tint: string }> = [
    { stage: 'dataline', label: 'Data Line', icon: Cable, tint: 'var(--role-effect)' },
    { stage: 'output', label: 'Output', icon: Plug, tint: 'var(--role-output)' },
  ];

  function addAt(e: MouseEvent, stage: DeviceStage): void {
    const surface = (e.currentTarget as HTMLElement).closest('.svelte-flow');
    const r = surface?.getBoundingClientRect();
    const c = flow.screenToFlowPosition(
      r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 },
    );
    add(stage, c.x, c.y);
  }
</script>

<div class="palette" role="toolbar" aria-label="Add device (local, not saved)">
  <span class="palette-label">Add</span>
  {#each DEVICES as d (d.stage)}
    {@const I = d.icon}
    <button
      class="palette-btn"
      onclick={(e) => addAt(e, d.stage)}
      title="Add {d.label} — local, not saved"
      style="--tint:{d.tint}"
    >
      <I size={14} aria-hidden="true" class="palette-ico" />
      {d.label}
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
