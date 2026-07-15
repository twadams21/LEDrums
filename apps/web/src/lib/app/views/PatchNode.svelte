<script lang="ts">
  /* Custom @xyflow/svelte LEAF node for the Patch Graph v2 (Output / Hoop / Trigger). A thin
     wrapper over the shared NodeCard (the source of the look): it picks the stage icon, hands the
     role colour to the card's chip, and renders the chain handles per the wiring rules —
       · Output: a SOURCE only (it roots a run; nothing wires INTO an output).
       · Hoop:   a TARGET (receives from its upstream) + a SOURCE (feeds one downstream hoop).
       · Trigger: no chain handle — only a NON-connectable anchor for the greyed dotted
         Trigger → Drum reference wire (binding by identity), plus a link badge.
     The selected ring + hover accent are the card's; clicking loads it into the Inspector
     (handled by the view). No lift/scale/click motion; hover is instant (locked contract). */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { getContext, type Component } from 'svelte';
  import type { PatchNodeData, PatchStage } from '../patch-topology';
  import { PATCH_STORE_KEY, type PatchStoreContext } from './patch-context';
  import { boundTriggerFor, zoneSlotsForDrum } from '../docks/patch-inspector';
  import NodeCard from './NodeCard.svelte';
  import Activity from '@lucide/svelte/icons/activity';
  import Zap from '@lucide/svelte/icons/zap';
  import Target from '@lucide/svelte/icons/target';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Circle from '@lucide/svelte/icons/circle';
  import Plug from '@lucide/svelte/icons/plug';
  import Cpu from '@lucide/svelte/icons/cpu';
  import LinkIcon from '@lucide/svelte/icons/link';

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
    output: Plug,
    controller: Cpu,
  };
  const Icon = $derived(STAGE_ICON[d.stage]);

  // A Trigger node earns its link badge only when its drum actually has an authored Trigger graph
  // bound by identity (the same lookup the Drum inspector's bound-trigger read-out uses) — the
  // dotted Trigger → Drum wire already shows the always-true drum binding, so an unconditional
  // badge is just noise. Unbound triggers show none.
  const triggerBound = $derived(
    d.stage === 'trigger' ? boundTriggerFor(id.replace(/^trigger:/, ''), store.graphs) !== null : false,
  );

  // The trigger face's "N zones" must match the Inspector's zones list — both count the drum's
  // WIRED zones (inputMap slots), not the physical sensor-zone total the seed sub was built from.
  // Live: wiring a zone in the Inspector reflows the count here. Falls back to the seed sub offline.
  const sub = $derived.by(() => {
    if (d.stage !== 'trigger' || !store.project) return d.sub;
    const n = zoneSlotsForDrum(store.project.inputMap, id.replace(/^trigger:/, '')).length;
    return `${n} zone${n === 1 ? '' : 's'}`;
  });
</script>

{#if d.stage === 'hoop'}
  <Handle type="target" position={Position.Left} />
{/if}
{#if d.stage === 'trigger'}
  <!-- non-connectable anchor for the dotted Trigger → Drum reference wire (drum sits to the left) -->
  <Handle type="source" position={Position.Left} isConnectable={false} />
{/if}

{#snippet linkBadge()}
  <LinkIcon size={11} aria-hidden="true" />
{/snippet}

<NodeCard
  icon={Icon}
  title={label}
  {sub}
  tint={d.role}
  selected={!!selected}
  badge={triggerBound ? linkBadge : undefined}
/>

<!-- Output always sources its run; a hoop sources the NEXT hoop only while it feeds one — a
     terminal hoop (end of the run / unwired) hides the handle, there's nothing downstream. -->
{#if d.stage === 'output' || (d.stage === 'hoop' && !d.terminal)}
  <Handle type="source" position={Position.Right} />
{/if}
