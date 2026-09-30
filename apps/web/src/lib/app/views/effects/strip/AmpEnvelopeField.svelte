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

  function setMode(next: string): void {
    api.setAmp(effect.id, { length: ampLengthFor(next as AmpLengthMode, amp.length) });
  }
</script>

<div class="amp" role="group" aria-label="Amp envelope">
  <svg class="shape" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
    <path d={path} />
  </svg>
  <ParamLine label="Attack">
    <FaceParamControl kind="number" value={amp.attackMs} display={formatMs(amp.attackMs)} min={0} max={2000} step={1}
      ariaLabel="Attack" {disabled} onGestureStart={begin} onGestureEnd={end}
      onChange={(v) => api.setAmp(effect.id, { attackMs: num(v) })} />
  </ParamLine>
  <ParamLine label="Decay">
    <FaceParamControl kind="number" value={amp.decayMs} display={formatMs(amp.decayMs)} min={0} max={2000} step={1}
      ariaLabel="Decay" {disabled} onGestureStart={begin} onGestureEnd={end}
      onChange={(v) => api.setAmp(effect.id, { decayMs: num(v) })} />
  </ParamLine>
  <ParamLine label="Sustain">
    <FaceParamControl kind="number" value={amp.sustainLevel} display={percent(amp.sustainLevel)} min={0} max={1} step={0.01}
      ariaLabel="Sustain" {disabled} onGestureStart={begin} onGestureEnd={end}
      onChange={(v) => api.setAmp(effect.id, { sustainLevel: num(v) })} />
  </ParamLine>
  <ParamLine label="Release">
    <FaceParamControl kind="number" value={amp.releaseMs} display={formatMs(amp.releaseMs)} min={0} max={4000} step={1}
      ariaLabel="Release" {disabled} onGestureStart={begin} onGestureEnd={end}
      onChange={(v) => api.setAmp(effect.id, { releaseMs: num(v) })} />
  </ParamLine>
  {#if always}
    <ParamLine label="Length"><span class="fixed">Loop</span></ParamLine>
  {:else}
    <ParamLine label="Length">
      <Select value={mode} options={AMP_LENGTH_OPTIONS} onChange={setMode} ariaLabel="Gate length" {disabled} segment={false} />
    </ParamLine>
    {#if typeof amp.length === 'object' && 'ms' in amp.length}
      {@const ms = amp.length.ms}
      <ParamLine label="Time">
        <FaceParamControl kind="number" value={ms} display={formatMs(ms)} min={0} max={8000} step={10}
          ariaLabel="Gate time" {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { ms: num(v) } })} />
      </ParamLine>
    {:else if typeof amp.length === 'object'}
      {@const beats = amp.length.beats}
      <ParamLine label="Beats">
        <FaceParamControl kind="number" value={beats} display={String(beats)} min={0} max={16} step={0.25}
          ariaLabel="Gate beats" {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { beats: num(v) } })} />
      </ParamLine>
    {/if}
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
  .fixed {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
</style>
