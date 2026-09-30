<script lang="ts">
  /* The Effect's amplitude envelope as a compact ADSR editor on the Trigger card: a live outline
     of the shape, the four stages as compact face controls, and the gate length (a time, a beat
     count, Hold until released, or Loop). Every drag is one undo step (begin/endGesture). An
     Always Effect's gate is always Loop, so its length reads as fixed instead of offering a
     choice the runtime ignores. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import FaceParamControl from '../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../ui/Select.svelte';
  import ParamLine from './ParamLine.svelte';
  import { AMP_LENGTH_OPTIONS, ampLengthFor, ampLengthMode, ampPath, formatMs, percent, type AmpLengthMode } from './strip-model';

  let { api, effect }: { api: EffectsAuthoringApi; effect: effectChain.Effect } = $props();

  const amp = $derived(effect.amp);
  const mode = $derived(ampLengthMode(amp.length));
  const always = $derived(effect.trigger.kind === 'always');
  const path = $derived(ampPath(amp, 200, 36));
  const disabled = $derived(!api.canEdit);

  const begin = () => api.beginGesture();
  const end = () => api.endGesture();
  const num = (v: number | string | boolean) => (typeof v === 'number' ? v : Number(v));

  const STAGES = [
    { key: 'attackMs', short: 'A', label: 'Attack', max: 2000, step: 1, format: formatMs },
    { key: 'decayMs', short: 'D', label: 'Decay', max: 2000, step: 1, format: formatMs },
    { key: 'sustainLevel', short: 'S', label: 'Sustain', max: 1, step: 0.01, format: percent },
    { key: 'releaseMs', short: 'R', label: 'Release', max: 4000, step: 1, format: formatMs },
  ] as const;

  function setMode(next: string): void {
    api.setAmp(effect.id, { length: ampLengthFor(next as AmpLengthMode, amp.length) });
  }
</script>

<div class="amp" role="group" aria-label="Amp envelope">
  <svg class="shape" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
    <path d={path} />
  </svg>
  <div class="stages">
    {#each STAGES as stage (stage.key)}
      <span class="stage">
        <span class="sk" title={stage.label}>{stage.short}</span>
        <FaceParamControl kind="number" value={amp[stage.key]} display={stage.format(amp[stage.key])} min={0} max={stage.max} step={stage.step}
          ariaLabel={stage.label} {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { [stage.key]: num(v) })} />
      </span>
    {/each}
  </div>
  {#if always}
    <ParamLine label="Length"><span class="fixed">Loop</span></ParamLine>
  {:else}
    <!-- The gate value rides the same line as its mode: the field alone (no rail), so both fit
         the card width and the face never needs to scroll for it. -->
    <ParamLine label="Length">
      <Select value={mode} options={AMP_LENGTH_OPTIONS} onChange={setMode} ariaLabel="Gate length" {disabled} segment={false} />
      {#if typeof amp.length === 'object' && 'ms' in amp.length}
        {@const ms = amp.length.ms}
        <FaceParamControl kind="number" value={ms} display={formatMs(ms)} min={0} step={10}
          ariaLabel="Gate time" {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { ms: Math.max(0, num(v)) } })} />
      {:else if typeof amp.length === 'object'}
        {@const beats = amp.length.beats}
        <FaceParamControl kind="number" value={beats} display={`${beats} bt`} min={0} step={0.25}
          ariaLabel="Gate beats" {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { beats: Math.max(0, num(v)) } })} />
      {/if}
    </ParamLine>
  {/if}
</div>

<style>
  .amp {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .shape {
    width: 100%;
    height: 36px;
    margin-bottom: var(--space-1);
    background: var(--surface-inset);
    border-radius: var(--radius-1);
  }
  .shape path {
    fill: color-mix(in oklch, var(--role-input) 16%, transparent);
    stroke: var(--role-input);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .stages {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px var(--space-2);
    margin-bottom: 2px;
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    min-height: 24px;
    min-width: 0;
  }
  .amp .stage :global(.rail) {
    width: 32px;
  }
  .sk {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .fixed {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
</style>
