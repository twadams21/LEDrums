<script lang="ts">
  /* Custom @xyflow/svelte node for the Trigger Graph — renders the shared NodeCard so
     it matches the Patch look. Display-only: every edit happens in the Inspector. It
     reads its LIVE model from the store (via context, keyed by the node id) so the
     title/sub/thumb stay reactive as the Inspector swaps effects or tweaks params.

       · play     → title = effect name, sub = preset, thumbnail = EffectThumb (right)
       · trigger  → title = drum · zone, sub = "Trigger"  (source only)
       · others   → title = kind label, sub = a short summary (chance 45%, switch on…)

     Handles: left target if the kind takes input, right source if it emits — so the
     trigger node has only a source and a play node only a target. */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import NodeCard from './NodeCard.svelte';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import { kindIcon, tint, kindLabel, kindSummary } from './trigger-node-meta';
  import { nodeHasInput, nodeHasOutput, type NodeKind } from '../../trigger-lab/sim';
  import { TRIGGER_STORE_KEY, type TriggerStoreContext } from './trigger-context';

  let { id, data, selected }: NodeProps = $props();

  const store = getContext<TriggerStoreContext>(TRIGGER_STORE_KEY);
  const kind = $derived((data as { kind: NodeKind }).kind);
  // the live store node (reactive — Inspector edits flow straight through)
  const node = $derived(store.selectedGraph?.nodes.find((n) => n.id === id) ?? null);
  const eff = $derived(node && node.kind === 'play' ? store.effectOf(node) : undefined);

  const title = $derived.by(() => {
    if (!node) return '';
    if (node.kind === 'trigger') return `${store.selectedPad?.drumLabel ?? ''} · ${store.selectedPad?.zoneLabel ?? ''}`;
    if (node.kind === 'play') return eff?.name ?? 'effect';
    return kindLabel[node.kind];
  });
  const sub = $derived.by(() => {
    if (!node) return '';
    if (node.kind === 'trigger') return 'Trigger';
    if (node.kind === 'play') return store.presetById(node.presetId)?.name ?? '';
    return kindSummary(node);
  });
  const Icon = $derived(kindIcon[kind] ?? kindIcon.play);
  const chipTint = $derived(tint[kind] ?? 'var(--accent)');
</script>

{#snippet playThumb()}
  {#if node && node.kind === 'play' && eff}
    <EffectThumb pattern={eff.pattern} params={store.liveParams(node)} w={56} h={32} />
  {/if}
{/snippet}

{#if nodeHasInput(kind)}
  <Handle type="target" position={Position.Left} />
{/if}

<NodeCard
  icon={Icon}
  {title}
  {sub}
  tint={chipTint}
  selected={!!selected}
  thumb={kind === 'play' && eff ? playThumb : undefined}
/>

{#if nodeHasOutput(kind)}
  <Handle type="source" position={Position.Right} />
{/if}
