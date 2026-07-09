<script lang="ts">
  /* LFO SOURCE node editor (doc 10, S36) — waveform, rate (free Hz OR musical division), and
     phase offset. A modulation source has no per-mapping depth/range of its own: those are
     edited on each wire, target-side, in the target node's Parameters section. The shared node
     header lives in the parent Inspector; this renders only the LFO-specific controls, built
     from the design-system primitives (SegmentedControl / Select / CommitInput / Slider). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import Field from '../../../ui/Field.svelte';
  import {
    DIVISION_OPTS,
    LFO_RATE_MODE_OPTS,
    LFO_WAVEFORM_OPTS,
    pct,
  } from '../../views/node-options';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const lfo = $derived(store.lfoSettings(node));
</script>

{#if node.kind === 'lfo'}
  <div class="kindbody">
    <Field layout="row" label="Wave">
      <Select
        value={lfo.waveform}
        options={LFO_WAVEFORM_OPTS}
        onChange={(v) => store.setLfo(node, { waveform: v as typeof lfo.waveform })}
        ariaLabel="LFO waveform"
      />
    </Field>

    <Field layout="row" label="Rate">
      <SegmentedControl
        value={lfo.rateMode}
        options={LFO_RATE_MODE_OPTS}
        onChange={(v) => store.setLfo(node, { rateMode: v as 'hz' | 'beats' })}
        ariaLabel="LFO rate mode"
      />
    </Field>

    {#if lfo.rateMode === 'hz'}
      <Field layout="row" label="Freq" unit="Hz">
        <CommitInput
          type="number"
          value={lfo.rateHz}
          min={0.01}
          max={60}
          step={0.01}
          onCommit={(v) => store.setLfo(node, { rateHz: Number(v) })}
          ariaLabel="LFO frequency in Hz"
        />
      </Field>
    {:else}
      <Field layout="row" label="Division">
        <Select
          value={lfo.division}
          options={DIVISION_OPTS}
          onChange={(v) => store.setLfo(node, { division: v })}
          ariaLabel="LFO division"
        />
      </Field>
    {/if}

    <Field layout="row" label="Phase" unit={pct(lfo.phase)}>
      <Slider
        value={lfo.phase}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => store.setLfo(node, { phase: v })}
        ariaLabel="LFO phase offset"
      />
    </Field>

    <p class="hint">
      Runs continuously off the transport clock — every live voice it's wired to sees the same
      value (no per-hit restart; that's what envelopes are for). Set a wire's depth, invert and
      range on the target node's Parameters section.
    </p>
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
</style>
