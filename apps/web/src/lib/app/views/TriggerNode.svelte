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
  import Link2 from '@lucide/svelte/icons/link-2';
  import Blend from '@lucide/svelte/icons/blend';
  import NodeCard from './NodeCard.svelte';
  import BandSwitchNode from './BandSwitchNode.svelte';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { kindIcon, tint, kindLabel, kindSummary, modifierName } from './trigger-node-meta';
  import { pct } from './node-options';
  import { nodeHasInput, nodeHasModInput, nodeHasOutput, type NodeKind } from '../../trigger-lab/sim';
  import { voice } from '@ledrums/core';
  import { describeTriggerSource, drumLinkHint } from '../trigger-source-label';
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
    if (node.kind === 'modifier') return modifierName(node.modifierId);
    return kindLabel[node.kind];
  });
  const sub = $derived.by(() => {
    if (!node) return '';
    // the resolved input source — drum · zone / MIDI note·CC / OSC address, or "unbound"
    if (node.kind === 'trigger') return describeTriggerSource(node.source, store.drums).sub;
    if (node.kind === 'play') return store.presetById(node.presetId)?.name ?? '';
    if (node.kind === 'modifier') return node.bypass ? 'bypassed' : 'modifier';
    return kindSummary(node);
  });

  // A play node's resolved modifier-chain length (mod→mod flattened) — drives the small
  // count chip riding the mod input handle, so the chain reads at a glance on the canvas.
  const modCount = $derived(
    node && node.kind === 'play' && store.selectedGraph
      ? voice.resolveModifierChain(store.selectedGraph, node).length
      : 0,
  );

  // Exposed modulation-target rows (doc 10, S34): each renders its own labelled node-face row
  // with a `param:<key>` input handle scoped to modulation sources. Play + modifier nodes only.
  const modRows = $derived.by(() => {
    if (!node || (node.kind !== 'play' && node.kind !== 'modifier')) return [];
    const rows = node.modInputs ?? [];
    if (rows.length === 0) return [];
    const specs = store.modTargetSpecs(node);
    return rows.map((r) => ({
      param: r.param,
      label: specs.find((s) => s.key === r.param)?.label ?? r.param,
      wired: store.mappingsFor(node, r.param).length,
    }));
  });
  const Icon = $derived(kindIcon[kind] ?? kindIcon.play);
  const chipTint = $derived(tint[kind] ?? 'var(--accent)');

  // Drum-link: a trigger node whose MIDI/OSC source is ALSO zone-mapped to a drum fires both
  // paths for one message (by design). Flag it with a corner badge naming the drum · zone.
  // Reads the authoritative patch input map; null offline / when not zone-mapped.
  const linkHint = $derived(
    node && node.kind === 'trigger' && store.project
      ? drumLinkHint(store.project.inputMap, node.source, store.drums)
      : null,
  );
</script>

{#snippet playThumb()}
  {#if node && node.kind === 'play' && eff}
    <EffectThumb pattern={eff.pattern} params={store.liveParams(node)} w={56} h={32} />
  {/if}
{/snippet}

{#snippet drumLinkBadge()}
  {#if linkHint}
    <Tooltip text={linkHint}>
      <span class="drumlink" aria-label={linkHint}><Link2 size={11} aria-hidden="true" /></span>
    </Tooltip>
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
  <!-- distinct `mod` input handle (play + modifier nodes) — a modifier-chain wire lands here.
       Offset below the flow input when the node also has one; centred otherwise. -->
  {#if nodeHasModInput(kind)}
    <Handle
      type="target"
      id="mod"
      position={Position.Left}
      class="mod-handle"
      style={nodeHasInput(kind) ? 'top: 74%' : 'top: 50%'}
    />
  {/if}

  {#if isBandsSwitch}
    <BandSwitchNode icon={Icon} {title} tint={chipTint} selected={!!selected} {bandLabels} />
  {:else}
    <div class="tnode" class:bypassed={kind === 'modifier' && !!node.bypass}>
      <NodeCard
        icon={Icon}
        {title}
        {sub}
        tint={chipTint}
        selected={!!selected}
        thumb={kind === 'play' && eff ? playThumb : undefined}
        badge={linkHint ? drumLinkBadge : undefined}
      />
      {#if modCount > 0}
        <span class="modcount" title={`${modCount} modifier${modCount === 1 ? '' : 's'} in chain`}>
          <Blend size={9} aria-hidden="true" />{modCount}
        </span>
      {/if}
    </div>
    {#if modRows.length > 0}
      <!-- exposed modulation-target rows: each is its own drop target (a `param:<key>` handle
           scoped to modulation sources). Precedent: the value+bands switch's per-band handles. -->
      <ul class="modrows">
        {#each modRows as row (row.param)}
          <li class="modrow" class:wired={row.wired > 0}>
            <Handle type="target" position={Position.Left} id={`param:${row.param}`} class="param-handle" />
            <span class="pdot" aria-hidden="true"></span>
            <span class="plabel">{row.label}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if nodeHasOutput(kind)}
      <Handle type="source" position={Position.Right} />
    {/if}
  {/if}
{/if}

<style>
  /* the drum-link badge glyph — inherits the badge's accent colour, centres the icon */
  .drumlink {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: inherit;
    line-height: 0;
  }
  /* wrapper so the resolved-chain count chip can ride the card's bottom-left (near the mod
     handle) without disturbing NodeCard's own grid */
  .tnode {
    position: relative;
  }
  /* a bypassed modifier reads as muted but present (its wire + state slot survive) */
  .tnode.bypassed {
    opacity: 0.55;
  }
  /* exposed modulation-target rows under the card — each carries a scoped `param:` handle */
  .modrows {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
  }
  .modrow {
    position: relative; /* offset parent for the per-row param handle (sits at the row's left) */
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 22px;
    padding: 0 var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
  }
  .pdot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    border: 1px solid color-mix(in oklch, var(--role-modulation) 60%, var(--border));
    background: transparent;
  }
  .modrow.wired .pdot {
    background: var(--role-modulation);
    border-color: var(--role-modulation);
  }
  .plabel {
    flex: 1;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* the scoped modulation input handle rides the row's left edge */
  .modrow :global(.param-handle) {
    background: var(--role-modulation);
    border-color: color-mix(in oklch, var(--role-modulation) 70%, var(--surface));
  }
  /* small "N in chain" chip anchored at the play node's mod input (bottom-left corner) */
  .modcount {
    position: absolute;
    left: -8px;
    bottom: -7px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 5px 1px 4px;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--role-mod);
    background: color-mix(in oklch, var(--role-mod) 16%, var(--surface-3));
    border: 1px solid color-mix(in oklch, var(--role-mod) 45%, transparent);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-1);
  }
</style>
