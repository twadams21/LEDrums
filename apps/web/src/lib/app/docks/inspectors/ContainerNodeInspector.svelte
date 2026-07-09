<script lang="ts">
  /* Container / modifier node body (random · switch · chance · all · sequence · toggle).
     The shared node header (kind selector + remove) lives in the parent Inspector; this
     renders only the per-kind controls. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, NodeKind, SwitchOn, ValueMode } from '../../../trigger-lab/sim';
  import Select from '../../../ui/Select.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import Field from '../../../ui/Field.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import { SWITCH_OPTS, VALUEMODE_OPTS, pct } from '../../views/node-options';
  import { mixLayerRowsFor } from '../../views/mix-layer-rows';
  import { BLEND_MODES, type BlendMode } from '@ledrums/core';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();
  const BLEND_OPTS = BLEND_MODES.map((mode) => ({ value: mode, label: mode }));
  const mixRows = $derived.by(() => {
    if (node.kind !== 'mix' || !store.selectedGraph) return [];
    return mixLayerRowsFor(store.selectedGraph, node.id, (nodeId) => store.liveNodeY(nodeId));
  });

  /** One-line description for the container/modifier kinds that take no extra control. */
  function kindBlurb(kind: NodeKind): string {
    switch (kind) {
      case 'all':
        return 'Plays every wired child at once.';
      case 'sequence':
        return 'Plays the next wired child on each hit, in order.';
      case 'toggle':
        return 'Alternates its child on / off with each hit.';
      default:
        return 'A container — wire its children on the canvas.';
    }
  }
</script>

{#if node.kind === 'random'}
  <div class="kindbody">
    <Field layout="row" label="No-repeat">
      <Toggle pressed={node.noRepeat} onChange={(v) => store.setNoRepeat(node, v)} ariaLabel="No-repeat" />
    </Field>
    <p class="hint">Picks a random wired child on each hit{node.noRepeat ? ', never the same one twice running' : ''}.</p>
  </div>
{:else if node.kind === 'switch'}
  <div class="kindbody">
    <Field layout="row" label="On">
      <Select value={node.on} options={SWITCH_OPTS} onChange={(v) => store.setSwitchOn(node, v as SwitchOn)} ariaLabel="Switch on" />
    </Field>
    {#if node.on === 'value'}
      {@const mode = node.valueMode ?? 'gate'}
      <SegmentedControl value={mode} options={VALUEMODE_OPTS} onChange={(v) => store.setValueMode(node, v as ValueMode)} ariaLabel="Value mode" />
      {#if mode === 'gate'}
        {@const threshold = node.threshold ?? 0.5}
        {@const invert = node.invert ?? false}
        <Field layout="row" label="Threshold">
          <Slider min={0} max={1} step={0.01} value={threshold} onChange={(v) => store.setThreshold(node, v)} format={pct} ariaLabel="Gate threshold" />
        </Field>
        <Field layout="row" label="Invert">
          <Toggle pressed={invert} onChange={(v) => store.setInvert(node, v)} ariaLabel="Invert gate" />
        </Field>
        <p class="hint">
          {invert
            ? `Passes when value > ${pct(threshold)} — does nothing below.`
            : `Passes when value ≤ ${pct(threshold)} — does nothing above.`}
        </p>
      {:else}
        {@const cuts = node.bands && node.bands.length ? node.bands : [0.5]}
        <div class="bandlist">
          {#each cuts as cut, i (i)}
            <div class="bandrow">
              <span class="bnum">{i + 1}</span>
              <span class="k">≤</span>
              <span class="sld"><Slider min={0} max={1} step={0.01} value={cut} onChange={(v) => store.setBandCutoff(node, i, v)} format={pct} ariaLabel={`Band ${i + 1} cutoff`} /></span>
              <IconButton icon={Trash2} label="Remove band" variant="soft" size={13} disabled={cuts.length <= 1} onclick={() => store.removeBand(node, i)} />
            </div>
          {/each}
          <div class="bandrow rest">
            <span class="bnum">{cuts.length + 1}</span>
            <span class="restlabel">&gt; {pct(cuts[cuts.length - 1]!)} — the rest</span>
          </div>
          <button class="addband" type="button" onclick={() => store.addBand(node)}>
            <Plus size={13} aria-hidden="true" /> Add band
          </button>
        </div>
        <p class="hint">{cuts.length + 1} bands — wire a child to each band's handle on the node.</p>
      {/if}
    {:else}
      <p class="hint">Routes to a wired child by {node.on}.</p>
    {/if}
  </div>
{:else if node.kind === 'chance'}
  <div class="kindbody">
    <Field layout="row" label="Chance">
      <Slider min={0} max={1} step={0.05} value={node.p} onChange={(v) => store.setChance(node, v)} format={(v) => `${Math.round(v * 100)}%`} />
    </Field>
    <p class="hint">Plays its wired child {Math.round(node.p * 100)}% of the time.</p>
  </div>
{:else if node.kind === 'mix'}
  <div class="kindbody">
    <Field layout="row" label="Blend">
      <Select
        value={node.mixBlendMode ?? 'normal'}
        options={BLEND_OPTS}
        onChange={(v) => store.setMixBlendMode(node, v as BlendMode)}
        ariaLabel="Mix blend mode"
      />
    </Field>
    {#if mixRows.length}
      <p class="hint">Layers stack in canvas order: the topmost branch is the base, and each branch below blends over it.</p>
      <div class="mixlist">
        {#each mixRows as row (row.edgeId)}
          <label class="mixctl">
            <span class="mname">{row.label}</span>
            <span class="sld">
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={row.opacity}
                onChange={(v) => store.setMixEdgeOpacity(row.edgeId, v)}
                format={pct}
                ariaLabel={`${row.label} opacity`}
              />
            </span>
          </label>
        {/each}
      </div>
    {:else}
      <p class="hint">Wire Effect or Modifier branches into Mix to build layer rows.</p>
    {/if}
  </div>
{:else}
  <div class="kindbody">
    <p class="hint">{kindBlurb(node.kind)}</p>
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .k {
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-2xs);
  }
  .sld {
    display: flex;
    flex: 1;
  }
  .mixlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .mixctl {
    display: grid;
    grid-template-columns: minmax(4rem, 0.8fr) minmax(0, 1.6fr);
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .mname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .bandlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .bandrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bandrow .sld {
    flex: 1;
    max-width: none;
  }
  .bnum {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
  }
  .bandrow.rest {
    color: var(--text-faint);
  }
  .restlabel {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .addband {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    transition:
      color var(--dur-150) ease,
      border-color var(--dur-150) ease;
  }
  .addband:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .addband:active {
    scale: 0.98;
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  @media (prefers-reduced-motion: reduce) {
    .addband {
      transition: none;
    }
  }
</style>
