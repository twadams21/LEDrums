<script lang="ts">
  /* Custom @xyflow/svelte node for the Patch Graph. Now a thin wrapper over the
     shared NodeCard (the source of the look): it picks the stage icon, hands the
     signal-flow role colour to the card's chip, and renders left/right connection
     handles (target unless it's the input source, source unless it's the controller
     sink). The selected ring + hover accent are the card's; clicking also loads it
     into the Inspector (handled by the view). */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { getContext, type Component } from 'svelte';
  import type { PatchNodeData, PatchStage } from '../patch-topology';
  import { PATCH_STORE_KEY, type PatchStoreContext } from './patch-context';
  import NodeCard from './NodeCard.svelte';
  import Activity from '@lucide/svelte/icons/activity';
  import Zap from '@lucide/svelte/icons/zap';
  import Target from '@lucide/svelte/icons/target';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Circle from '@lucide/svelte/icons/circle';
  import Cable from '@lucide/svelte/icons/cable';
  import Plug from '@lucide/svelte/icons/plug';
  import Cpu from '@lucide/svelte/icons/cpu';

  let { id, data, selected }: NodeProps = $props();
  // xyflow types node data as Record<string, unknown> in the registry; this graph
  // only ever mounts PatchNode for `patch` nodes, whose data is PatchNodeData.
  const d = $derived(data as PatchNodeData);
  const store = getContext<PatchStoreContext>(PATCH_STORE_KEY);
  // Prefer the Inspector rename override on the face (reactive — a rename updates it
  // live); fall back to the derived stage label. Mirrors the Inspector's patchLabel().
  const label = $derived(store.patchLabels[id]?.trim() || d.label);

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

<NodeCard icon={Icon} title={label} sub={d.sub} tint={d.role} selected={!!selected} />

{#if d.stage !== 'controller'}
  <Handle type="source" position={Position.Right} />
{/if}
