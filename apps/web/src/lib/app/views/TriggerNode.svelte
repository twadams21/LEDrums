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
  import NodeSignalPreview from './NodeSignalPreview.svelte';
  import NodeStatePreview from './NodeStatePreview.svelte';
  import ParamRowTick from './ParamRowTick.svelte';
  import { paramRowSignal, previewCtx } from '../../trigger-lab/signal-preview';
  import Tooltip from '../../ui/Tooltip.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { kindIcon, tint, kindLabel, kindSummary, modifierName } from './trigger-node-meta';
  import { pct } from './node-options';
  import {
  nodeHasInput,
  nodeHasModInput,
  nodeHasOutput,
  nodeIsModSource,
  type NodeKind,
} from '../../trigger-lab/sim';
  import { voice, collectionMeta } from '@ledrums/core';
  import { describeTriggerSource, drumLinkHint } from '../trigger-source-label';
  import { TRIGGER_STORE_KEY, type TriggerStoreContext } from './trigger-context';
  import { GRAPH_LINT_KEY, type GraphLintIndex } from './graph-lint-index.svelte';
  import { mixLayerRowsFor } from './mix-layer-rows';

  let { id, data, selected }: NodeProps = $props();

  const store = getContext<TriggerStoreContext>(TRIGGER_STORE_KEY);
  // Lint findings anchored to THIS node (R06) — the same findings the strip shows, indexed by
  // node id. Drives the corner badge; empty when the node is clean.
  const lint = getContext<GraphLintIndex | undefined>(GRAPH_LINT_KEY);
  const lintFindings = $derived(lint?.forNode(id) ?? []);
  const kind = $derived((data as { kind: NodeKind }).kind);
  // the live store node (reactive — Inspector edits flow straight through)
  const node = $derived(store.selectedGraph?.nodes.find((n) => n.id === id) ?? null);
  const isEffectNode = $derived(node?.kind === 'play' || node?.kind === 'effect');
  const eff = $derived(node && isEffectNode ? store.effectOf(node) : undefined);

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
    if (node.kind === 'play' || node.kind === 'effect') return eff?.name ?? 'effect';
    if (node.kind === 'modifier') return modifierName(node.modifierId);
    return kindLabel[node.kind];
  });
  // play-type sub-label (D3) — the node's collection name, shown as a NodeCard chip. Falls
  // back to the effect's own play type for graphs authored before the node carried one.
  const playTypeChip = $derived.by(() => {
    if (!node || (node.kind !== 'play' && node.kind !== 'effect')) return undefined;
    const type = node.playType ?? eff?.playType ?? 'ambient';
    return collectionMeta(type).label;
  });
  const sub = $derived.by(() => {
    if (!node) return '';
    // the resolved input source — drum · zone / MIDI note·CC / OSC address, or "unbound"
    if (node.kind === 'trigger') return describeTriggerSource(node.source, store.drums).sub;
    if (node.kind === 'play' || node.kind === 'effect') return store.presetById(node.presetId)?.name ?? '';
    if (node.kind === 'modifier') return node.bypass ? 'bypassed' : 'modifier';
    return kindSummary(node);
  });

  // A play node's resolved modifier-chain length (mod→mod flattened) — drives the small
  // count chip riding the mod input handle, so the chain reads at a glance on the canvas.
  const modCount = $derived(
    node && isEffectNode && store.selectedGraph
      ? voice.resolveModifierChain(store.selectedGraph, node).length
      : 0,
  );

  // Exposed modulation-target rows (doc 10, S34): each renders its own labelled node-face row
  // with a `param:<key>` input handle scoped to modulation sources. Play + modifier nodes only.
  const modRows = $derived.by(() => {
    if (!node || (node.kind !== 'play' && node.kind !== 'effect' && node.kind !== 'modifier')) return [];
    const rows = node.modInputs ?? [];
    if (rows.length === 0) return [];
    const specs = store.modTargetSpecs(node);
    return rows.map((r) => ({
      param: r.param,
      label: specs.find((s) => s.key === r.param)?.label ?? r.param,
      // resolved wired sources drive both the "wired" state and the S38 live value tick
      sources: store.modSourcesFor(node, r.param),
    }));
  });
  const mixRows = $derived.by(() => {
    if (!node || node.kind !== 'mix' || !store.selectedGraph) return [];
    return mixLayerRowsFor(store.selectedGraph, node.id, (nodeId) => store.liveNodeY(nodeId));
  });

  // A modulation SOURCE node (envelope / LFO / CC) shows a live signal preview on its face,
  // mirroring how a play node shows its EffectThumb (S38). Sampled through core, ticker-driven.
  const isSourceKind = $derived(kind === 'envelope' || kind === 'lfo' || kind === 'cc' || kind === 'note' || kind === 'osc' || kind === 'randomMod');
  // Gating / routing kinds get a STATE face (wave-4 decision 1): static configured state +
  // a trigger-driven flash. (Bands switches keep their dedicated BandSwitchNode face.)
  const isStateKind = $derived(
    kind === 'chance' || kind === 'toggle' || kind === 'delay' || kind === 'sequence' ||
    kind === 'all' || kind === 'random' || kind === 'switch' || kind === 'modifier' || kind === 'mix',
  );
  // Wired default-port children — sizes the fan / sequence-step faces.
  const wiredChildren = $derived(
    store.selectedGraph ? store.selectedGraph.edges.filter((e) => e.from === id && !e.fromPort).length : 0,
  );
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

  // Right-click verbs (copy / paste / duplicate / delete). The trigger node is fixed — a graph
  // has exactly one — so it only offers Paste; every other node offers the full set. Delete
  // routes through a confirmation dialog. Hidden entirely for read-only viewers.
  let confirmDelete = $state(false);
  const actions = $derived.by<ContextMenuAction[]>(() => {
    if (!node) return [];
    const canPaste = store.nodeClipboard !== null;
    if (node.kind === 'trigger' || node.kind === 'output') {
      return [{ label: 'Paste', icon: ClipboardPaste, disabled: !canPaste, onSelect: () => store.pasteNode() }];
    }
    const n = node;
    return [
      { label: 'Copy', icon: Copy, onSelect: () => store.copyNode(n) },
      { label: 'Paste', icon: ClipboardPaste, disabled: !canPaste, onSelect: () => store.pasteNode() },
      { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateNode(n) },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => (confirmDelete = true) },
    ];
  });
</script>

{#snippet playThumb()}
  {#if node && isEffectNode && eff}
    <EffectThumb
      params={store.liveParams(node)}
      generatorId={eff.generatorId}
      labModel={store.labModel}
      w={56}
      h={32}
    />
  {/if}
{/snippet}

{#snippet sourceThumb()}
  {#if node && node.kind === 'envelope'}
    <NodeSignalPreview
      kind="envelope"
      env={store.envelopeNodeEnvelope(node) ?? undefined}
      fireAt={store.selectedGraphFireAt}
      w={56}
      h={32}
    />
  {:else if node && node.kind === 'lfo'}
    <NodeSignalPreview kind="lfo" lfo={store.lfoSettings(node)} bpm={store.bpm} w={56} h={32} />
  {:else if node && node.kind === 'cc'}
    <NodeSignalPreview kind="cc" ccValue={() => store.ccNodeLiveValue(node)} w={56} h={32} />
  {:else if node && node.kind === 'note'}
    <NodeSignalPreview kind="note" ccValue={() => store.noteNodeLiveValue(node)} w={56} h={32} />
  {:else if node && node.kind === 'osc'}
    <NodeSignalPreview kind="osc" ccValue={() => store.oscNodeLiveValue(node)} w={56} h={32} />
  {:else if node && node.kind === 'randomMod'}
    <NodeSignalPreview kind="random" w={56} h={32} />
  {/if}
{/snippet}

{#snippet stateThumb()}
  {#if node}
    <NodeStatePreview
      {node}
      childCount={wiredChildren}
      bpm={store.bpm}
      fireAt={store.selectedGraphFireAt}
      tintToken={(tint[kind] ?? 'var(--accent)').slice(4, -1)}
      w={56}
      h={32}
    />
  {/if}
{/snippet}

{#snippet drumLinkBadge()}
  {#if linkHint}
    <Tooltip text={linkHint}>
      <span class="drumlink" aria-label={linkHint}><Link2 size={11} aria-hidden="true" /></span>
    </Tooltip>
  {/if}
{/snippet}

<!-- Lint badge (R06): a warn-toned corner marker on any node the render-plan compiler flagged,
     carrying the SAME finding the lint strip shows (empty scope, a cycle member, …). Instant,
     no motion (the locked node interaction contract); the tooltip names the problem + fix. -->
{#snippet lintBadge()}
  {#if lintFindings.length > 0}
    {@const primary = lintFindings[0]!}
    <Tooltip text={`${primary.problem}. ${primary.action}`}>
      <span class="lintbadge" role="status" aria-label={`${primary.problem}. ${primary.action}`}>
        <TriangleAlert size={11} aria-hidden="true" />
      </span>
    </Tooltip>
  {/if}
{/snippet}

<!-- Wiring handles anchored to the card HEAD row (NodeCard renders these inside its
     position:relative head, so their %-offsets track the head — a param footer growing
     the card can't drag them off the face (item 1.7 / E). -->
{#snippet cardHandles()}
  {#if nodeHasInput(kind)}
    <Handle type="target" position={Position.Left} class={kind === 'play' || kind === 'effect' ? 'trigger-handle' : 'effect-handle'} aria-label={kind === 'play' || kind === 'effect' ? 'Trigger flow in' : 'Effect flow in'} style={nodeHasModInput(kind) ? 'top: 35%' : 'top: 50%'} />
  {/if}
  {#if nodeHasModInput(kind)}
    <Handle
      type="target"
      id="mod"
      position={Position.Left}
      class="mod-handle"
      aria-label="Modifier chain in"
      style={nodeHasInput(kind) ? 'top: 65%' : 'top: 50%'}
    />
  {/if}
  {#if nodeHasOutput(kind)}
    <Handle type="source" position={Position.Right} class={kind === 'trigger' ? 'trigger-handle' : 'effect-handle'} aria-label={kind === 'trigger' ? 'Trigger flow out' : 'Effect flow out'} />
  {/if}
  {#if nodeIsModSource(kind)}
    <Handle
      type="source"
      position={Position.Right}
      class="mod-source-handle"
      title="Modulation output"
      aria-label="Modulation output"
    />
  {/if}
  {#if modCount > 0}
    <span class="modcount" title={`${modCount} modifier${modCount === 1 ? '' : 's'} in chain`}>
      <Blend size={9} aria-hidden="true" />{modCount}
    </span>
  {/if}
{/snippet}

<!-- Exposed modulation-target rows — rendered INSIDE the node card (NodeCard footer): one
     border, one surface, concentric radii (item E). Each row is its own drop target (a
     `param:<key>` handle scoped to modulation sources). -->
{#snippet paramFooter()}
  <ul class="noderows">
    {#each modRows as row (row.param)}
      <li class="modrow" class:wired={row.sources.length > 0}>
        <Handle type="target" position={Position.Left} id={`param:${row.param}`} class="param-handle" aria-label={`Modulation in: ${row.label}`} />
        <span class="pdot" aria-hidden="true"></span>
        <span class="plabel">{row.label}</span>
        <ParamRowTick
          sample={(tMs) => paramRowSignal(row.sources, previewCtx(tMs, store.bpm, store.liveCcTable, store.liveOscTable))}
        />
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet mixFooter()}
  <ul class="noderows">
    {#each mixRows as row (row.edgeId)}
      <li class="mixrow">
        <Handle type="target" position={Position.Left} id={row.handleId} class="mix-handle effect-handle" aria-label={`Layer in: ${row.label}`} />
        <span class="ldot" aria-hidden="true"></span>
        <span class="plabel">{row.label}</span>
        <span class="opacity">{Math.round(row.opacity * 100)}%</span>
      </li>
    {/each}
  </ul>
{/snippet}

{#if !node}
  <!-- The live model for this id is gone from the current graph — a projection / cache
       desync (incident 09). Render a VISIBLE stale placeholder (dashed warn card, id in the
       sub) instead of a blank card, so the fault is obvious on the canvas and in a screen
       capture, not a silent blank. No handles: a stale node is not a valid wiring target. -->
  <NodeCard icon={TriangleAlert} title="Stale node" sub={id} tint="var(--warn)" stale selected={!!selected} />
{:else}
  <ContextMenu {actions} disabled={store.isViewer}>
  {#if isBandsSwitch}
    {#if nodeHasInput(kind)}
      <Handle type="target" position={Position.Left} aria-label="Trigger flow in" />
    {/if}
    <BandSwitchNode icon={Icon} {title} tint={chipTint} selected={!!selected} {bandLabels} />
  {:else}
    <div class="tnode" class:bypassed={kind === 'modifier' && !!node.bypass} class:linted={lintFindings.length > 0}>
      <NodeCard
        icon={Icon}
        {title}
        {sub}
        tint={chipTint}
        typeChip={playTypeChip}
        selected={!!selected}
        thumb={(kind === 'play' || kind === 'effect') && eff ? playThumb : isSourceKind ? sourceThumb : isStateKind ? stateThumb : undefined}
        badge={linkHint ? drumLinkBadge : undefined}
        leadHandles={cardHandles}
        footer={mixRows.length > 0 ? mixFooter : modRows.length > 0 ? paramFooter : undefined}
      />
      {@render lintBadge()}
    </div>
  {/if}
  </ContextMenu>
  {#if node.kind !== 'trigger' && node.kind !== 'output'}
    <ConfirmDialog
      bind:open={confirmDelete}
      title="Delete node?"
      message={`Delete this ${kindLabel[node.kind]} node? This can’t be undone.`}
      confirmLabel="Delete"
      danger
      onConfirm={() => node && store.removeNode(node)}
    />
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
  /* a flagged node carries a faint warn wash on its card so the fault reads at a glance even
     before the corner badge is noticed — guides authoring (warn), never the red fault alarm. */
  .tnode.linted :global(.card) {
    border-color: color-mix(in oklch, var(--warn) 55%, var(--border));
  }
  /* the lint badge — a warn-toned corner marker (top-left, opposite the drum-link badge) that
     rides the card corner like `.modcount`. No motion: the badge is instant (locked contract). */
  .lintbadge {
    position: absolute;
    top: -7px;
    left: -7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-pill);
    color: var(--warn);
    background: color-mix(in oklch, var(--warn) 16%, var(--surface-3));
    border: 1px solid color-mix(in oklch, var(--warn) 55%, transparent);
    box-shadow: var(--shadow-1);
    line-height: 0;
  }
  /* exposed modulation-target rows — now INSIDE the node card (NodeCard footer), so no
     border / surface / shadow of their own: the card supplies the single border + surface. */
  .noderows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .modrow,
  .mixrow {
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
  .mixrow {
    background: color-mix(in oklch, var(--role-mod) 10%, var(--surface-inset));
  }
  .pdot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    border: 1px solid color-mix(in oklch, var(--role-modulation) 60%, var(--border));
    background: transparent;
  }
  .ldot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--role-mod);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--role-mod) 65%, transparent);
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
  .opacity {
    flex: none;
    min-width: 3ch;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
    text-align: right;
  }
  /* the scoped modulation input handle rides the row's left edge */
.modrow :global(.param-handle) {
  left: -12px;
  background: var(--role-modulation);
  border-color: color-mix(in oklch, var(--role-modulation) 70%, var(--surface));
}

/* the modulation OUTPUT handle mirrors the param INPUT handle's -12px role offset and sits at
   the node's vertical centre (a mod-source node has no other handle to share the face with).
   Its role colour is owned by GraphCanvas (`.mod-source-handle`) so it beats the grey base. */
.tnode :global(.mod-source-handle) {
  right: -12px;
  top: 50%;
}

.mixrow :global(.mix-handle) {
  left: -12px;
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
