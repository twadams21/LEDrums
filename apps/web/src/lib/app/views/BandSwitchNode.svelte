<script lang="ts">
  /* The value+bands variant of the Trigger Graph's switch node — extracted from
     TriggerNode (#9 companion). A value+bands switch fans out ONE source handle per
     value band (`band-${i}`), each on its own row with a cutoff readout, so a different
     child can be wired per band. Display-only: the shared NodeCard renders the head; the
     band rows + their per-band handles render below it. The caller derives `bandLabels`
     (it owns the live store node). */
  import { Handle, Position } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import NodeCard from './NodeCard.svelte';

  let {
    icon: Icon,
    title,
    tint,
    selected = false,
    bandLabels,
  }: {
    icon: Component;
    title: string;
    /** CSS colour for the card's icon chip. */
    tint: string;
    selected?: boolean;
    /** Per-band readout labels (band i fires when value ≤ cutoff i; the last is "the rest"). */
    bandLabels: string[];
  } = $props();
</script>

<div class="switchnode">
  <NodeCard icon={Icon} {title} sub="bands" {tint} selected={!!selected} />
  <ul class="bands">
    {#each bandLabels as label, i (i)}
      <li class="brow">
        <span class="bnum">{i + 1}</span>
        <span class="blabel">{label}</span>
        <Handle type="source" position={Position.Right} id={`band-${i}`} class="bhandle" />
      </li>
    {/each}
  </ul>
</div>

<style>
  .switchnode {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 176px;
  }
  .bands {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
  }
  .brow {
    position: relative; /* offset parent for the per-band handle (sits at the row's right) */
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 22px;
    padding: 0 var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
  }
  .bnum {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
  }
  .blabel {
    flex: 1;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
