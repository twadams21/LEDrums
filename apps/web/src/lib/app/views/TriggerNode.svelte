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
  import NodeCard from './NodeCard.svelte';
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

{#if nodeHasInput(kind)}
  <Handle type="target" position={Position.Left} />
{/if}

{#if isBandsSwitch}
  <div class="switchnode">
    <NodeCard icon={Icon} {title} sub="bands" tint={chipTint} selected={!!selected} />
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
