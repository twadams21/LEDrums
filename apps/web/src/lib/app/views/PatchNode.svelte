<script lang="ts">
  /* Custom @xyflow/svelte node for the Patch Graph. Carries the signal-flow role
     colour on its icon chip (per the design system), a title + mono sub line, and
     left/right connection handles (target unless it's the input source, source
     unless it's the controller sink). The selected ring mirrors the canvas
     selection; clicking also loads it into the Inspector (handled by the view). */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import type { PatchNodeData, PatchStage } from '../patch-topology';
  import Activity from '@lucide/svelte/icons/activity';
  import Zap from '@lucide/svelte/icons/zap';
  import Target from '@lucide/svelte/icons/target';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Circle from '@lucide/svelte/icons/circle';
  import Cable from '@lucide/svelte/icons/cable';
  import Plug from '@lucide/svelte/icons/plug';
  import Cpu from '@lucide/svelte/icons/cpu';

  let { data, selected }: NodeProps = $props();
  // xyflow types node data as Record<string, unknown> in the registry; this graph
  // only ever mounts PatchNode for `patch` nodes, whose data is PatchNodeData.
  const d = $derived(data as PatchNodeData);

  const STAGE_ICON: Record<PatchStage, Component> = {
    input: Activity,
    trigger: Zap,
    zone: Target,
    drum: Disc3,
    hoop: Circle,
    dataline: Cable,
    output: Plug,
    controller: Cpu,
  };
  const Icon = $derived(STAGE_ICON[d.stage]);
</script>

{#if d.stage !== 'input'}
  <Handle type="target" position={Position.Left} />
{/if}

<div class="pnode" class:sel={selected} style="--role:{d.role}">
  <span class="picon"><Icon size={16} aria-hidden="true" /></span>
  <span class="ptitle">{d.label}</span>
  <span class="psub">{d.sub}</span>
</div>

{#if d.stage !== 'controller'}
  <Handle type="source" position={Position.Right} />
{/if}

<style>
  .pnode {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: 'icon title' 'icon sub';
    align-items: center;
    column-gap: var(--space-2);
    width: 176px;
    padding: var(--space-2) var(--space-3);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
    transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }
  .pnode:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  /* selected into the canvas / Inspector — accent ring, on the role-tinted icon */
  .pnode.sel {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--accent) 45%, transparent), var(--shadow-1);
  }
  /* signal-path role colour rides the icon chip (icon + tinted wash) */
  .picon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    color: var(--role);
    background: color-mix(in oklch, var(--role) 16%, transparent);
  }
  .ptitle {
    grid-area: title;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .psub {
    grid-area: sub;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-reduced-motion: reduce) {
    .pnode {
      transition: none;
    }
  }
</style>
