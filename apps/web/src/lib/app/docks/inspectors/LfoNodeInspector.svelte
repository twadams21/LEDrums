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
    <label class="lblrow">
      <span class="k">Wave</span>
      <Select
        value={lfo.waveform}
        options={LFO_WAVEFORM_OPTS}
        onChange={(v) => store.setLfo(node, { waveform: v as typeof lfo.waveform })}
        ariaLabel="LFO waveform"
      />
    </label>

    <label class="lblrow">
      <span class="k">Rate</span>
      <SegmentedControl
        value={lfo.rateMode}
        options={LFO_RATE_MODE_OPTS}
        onChange={(v) => store.setLfo(node, { rateMode: v as 'hz' | 'beats' })}
        ariaLabel="LFO rate mode"
      />
    </label>

    {#if lfo.rateMode === 'hz'}
      <label class="lblrow">
        <span class="k">Freq</span>
        <span class="input-wrap">
          <CommitInput
            type="number"
            value={lfo.rateHz}
            min={0.01}
            max={60}
            step={0.01}
            onCommit={(v) => store.setLfo(node, { rateHz: Number(v) })}
            ariaLabel="LFO frequency in Hz"
          />
        </span>
        <span class="unit">Hz</span>
      </label>
    {:else}
      <label class="lblrow">
        <span class="k">Division</span>
        <Select
          value={lfo.division}
          options={DIVISION_OPTS}
          onChange={(v) => store.setLfo(node, { division: v })}
          ariaLabel="LFO division"
        />
      </label>
    {/if}

    <label class="lblrow">
      <span class="k">Phase</span>
      <span class="input-wrap">
        <Slider
          value={lfo.phase}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => store.setLfo(node, { phase: v })}
          ariaLabel="LFO phase offset"
        />
      </span>
      <span class="unit">{pct(lfo.phase)}</span>
    </label>

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
  .lblrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
    white-space: nowrap;
    flex: none;
    width: 56px;
  }
  .input-wrap {
    flex: 1;
    min-width: 0;
  }
  .unit {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    flex: none;
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
</style>
