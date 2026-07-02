<script lang="ts">
  /* Minimal xyflow node for the styleguide's live graph demo — renders the REAL
     shared NodeCard face from static data (the app's TriggerNode/PatchNode read a
     live store instead; the face and handles are identical). */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { Component } from 'svelte';
  import NodeCard from '../app/views/NodeCard.svelte';

  type GraphDemoData = {
    icon: Component;
    title: string;
    sub: string;
    tint: string;
    hasInput: boolean;
    hasOutput: boolean;
  };

  let { data, selected }: NodeProps = $props();
  const d = $derived(data as GraphDemoData);
</script>

{#if d.hasInput}
  <Handle type="target" position={Position.Left} />
{/if}
<NodeCard icon={d.icon} title={d.title} sub={d.sub} tint={d.tint} selected={!!selected} />
{#if d.hasOutput}
  <Handle type="source" position={Position.Right} />
{/if}
