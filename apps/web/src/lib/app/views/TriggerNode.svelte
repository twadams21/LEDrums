<script lang="ts">
  /* Custom @xyflow/svelte node for the Trigger Graph — renders the shared NodeCard so
     it matches the Patch look. Display-only: every edit happens in the Inspector. It
     reads its LIVE model from the store (via context, keyed by the node id) so the
     title/sub/thumb stay reactive as the Inspector swaps effects or tweaks params.

       · play     → title = effect name, sub = preset, thumbnail = EffectThumb (right)
       · trigger  → title = "Trigger", sub = the resolved input source (drum · zone /
                    MIDI note · CC / OSC address, or "unbound" when not yet bound)
       · others   → title = kind label, sub = a short summary (chance 45%, switch on…)

     Handles: left target if the kind takes input, right source if it emits — so the
     trigger node has only a source and a play node only a target. A value+bands switch
     is the exception: it emits ONE source handle per band (`band-${i}`), each on its
     own row with a cutoff readout, so a different child can be wired per value band. */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import NodeCard from './NodeCard.svelte';
  import BandSwitchNode from './BandSwitchNode.svelte';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import { kindIcon, tint, kindLabel, kindSummary } from './trigger-node-meta';
  import { pct } from './node-options';
  import { nodeHasInput, nodeHasOutput, type NodeKind } from '../../trigger-lab/sim';
  import { describeTriggerSource } from '../trigger-source-label';
  import { TRIGGER_STORE_KEY, type TriggerStoreContext } from './trigger-context';

  let { id, data, selected }: NodeProps = $props();

  const store = getContext<TriggerStoreContext>(TRIGGER_STORE_KEY);
  const kind = $derived((data as { kind: NodeKind }).kind);
  // the live store node (reactive — Inspector edits flow straight through)
  const node = $derived(store.selectedGraph?.nodes.find((n) => n.id === id) ?? null);
  const eff = $derived(node && node.kind === 'play' ? store.effectOf(node) : undefined);

  // a value+bands switch fans out one source handle per band (the rest render a single
  // default output handle). The cutoffs default defensively (older persisted graphs).
  const isBandsSwitch = $derived(
    !!node && node.kind === 'switch' && node.on === 'value' && (node.valueMode ?? 'gate') === 'bands',
  );
  /** Per-band readout labels: band i fires when value ≤ cutoff i; the last is "the rest". */
  const bandLabels = $derived.by(() => {
    if (!node) return [];
    const cuts = node.bands && node.bands.length ? node.bands : [0.5];
    return [...cuts.map((c) => `≤ ${pct(c)}`), `> ${pct(cuts[cuts.length - 1]!)}`];
  });

  const title = $derived.by(() => {
    if (!node) return '';
    if (node.kind === 'trigger') return 'Trigger';
    if (node.kind === 'play') return eff?.name ?? 'effect';
    return kindLabel[node.kind];
  });
  const sub = $derived.by(() => {
    if (!node) return '';
    // the resolved input source — drum · zone / MIDI note·CC / OSC address, or "unbound"
    if (node.kind === 'trigger') return describeTriggerSource(node.source, store.drums).sub;
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

{#if !node}
  <!-- The live model for this id is gone from the current graph — a projection / cache
       desync (incident 09). Render a VISIBLE stale placeholder (dashed warn card, id in the
       sub) instead of a blank card, so the fault is obvious on the canvas and in a screen
       capture, not a silent blank. No handles: a stale node is not a valid wiring target. -->
  <NodeCard icon={TriangleAlert} title="Stale node" sub={id} tint="var(--warn)" stale selected={!!selected} />
{:else}
  {#if nodeHasInput(kind)}
    <Handle type="target" position={Position.Left} />
  {/if}

  {#if isBandsSwitch}
    <BandSwitchNode icon={Icon} {title} tint={chipTint} selected={!!selected} {bandLabels} />
  {:else}
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
  {/if}
{/if}
