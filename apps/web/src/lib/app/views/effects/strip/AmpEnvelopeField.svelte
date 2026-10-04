<script lang="ts">
  /* The Effect's brightness envelope on the Trigger card (Tim, 2026-10-01: the Splice / Slice
     "brightness envelope" as THE way a hit lights, in place of the ADSR): a live outline, then
     Attack · Curve · Sustain · Decay in the Splice inspector's words. Attack and Decay are each in ms
     or beats; Sustain is how long the light stays up from the hit — a time, a beat count, While
     held (until the note is released), or Loop. A beat value reads as a division where it is one
     (1/16) and can be typed as one.
     One envelope per Effect: a Splice / Slice part that pulses or fades in its turn runs this same
     envelope. The old ADSR's drop to a lower level shows only on an Effect that still uses one,
     so a saved show plays exactly as before. Every drag is one undo step (begin/endGesture). An
     Always Effect always loops, so its Sustain reads as fixed. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import FaceParamControl from '../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../ui/Select.svelte';
  import EasePicker from '../../../../ui/EasePicker.svelte';
  import Tooltip from '../../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';
  import ParamLine from './ParamLine.svelte';
  import {
    ampLengthOptions,
    ampLengthFor,
    ampLengthMode,
    ampPath,
    beatsLabel,
    formatMs,
    percent,
    stageUnitPatch,
    type AmpLengthMode,
  } from './strip-model';

  let { api, effect }: { api: EffectsAuthoringApi; effect: effectChain.Effect } = $props();

  const amp = $derived(effect.amp);
  const mode = $derived(ampLengthMode(amp.length));
  const always = $derived(effect.trigger.kind === 'always');
  const path = $derived(ampPath(amp, 200, 24));
  const disabled = $derived(!api.canEdit);
  // The old ADSR's drop: shown only where an Effect still has one (a new Effect never does).
  const legacyDrop = $derived(amp.decayMs > 0 || amp.sustainLevel < 1);

  const begin = () => api.beginGesture();
  const end = () => api.endGesture();
  const num = (v: number | string | boolean) => (typeof v === 'number' ? v : Number(v));

  const STAGE_UNITS = [
    { value: 'ms', label: 'ms' },
    { value: 'beats', label: 'Beats' },
  ];
  type Stage = 'attack' | 'release';
  const stageBeats = (stage: Stage): number | undefined => (stage === 'attack' ? amp.attackBeats : amp.releaseBeats);
  function setStageUnit(stage: Stage, unit: string): void {
    const patch = stageUnitPatch(stage, unit as 'ms' | 'beats', amp);
    if (Object.keys(patch).length) api.setAmp(effect.id, patch);
  }

  function setMode(next: string): void {
    api.setAmp(effect.id, { length: ampLengthFor(next as AmpLengthMode, amp.length) });
  }
  function setCurve(spec: { fn: string; dir: string }): void {
    api.setAmp(effect.id, { attackEase: spec.fn === 'linear' ? undefined : (spec as effectChain.AmpEnvelope['attackEase']) });
  }

  // "Until dots end" joins the choices where the Generator can say when its content ends (Dot).
  const lengthOptions = $derived(ampLengthOptions(effect.generator));
  const SUSTAIN_INFO =
    'How long the light stays up from the hit (the attack included): a time, a number of beats, while the note is held, or looping — or, on a Dot, until its last dot ends (each dot\'s Lifespan decides). Then it decays.';
  const CURVE_INFO = 'A linear attack reads as brightening too fast — an ease-in curve swells more evenly.';
  const DROP_INFO =
    'From the old ADSR envelope: after the attack the light drops to this level over the Drop time. Set Drop to 100% to remove it.';
</script>

<!-- Attack / Decay: a unit (ms or beats) and its value, in one line like Sustain's. -->
{#snippet stageRow(stage: Stage, label: string, ms: number)}
  {@const beats = stageBeats(stage)}
  {@const msKey = stage === 'attack' ? 'attackMs' : 'releaseMs'}
  {@const beatsKey = stage === 'attack' ? 'attackBeats' : 'releaseBeats'}
  <ParamLine {label}>
    <Select value={beats === undefined ? 'ms' : 'beats'} options={STAGE_UNITS} segment={false} {disabled}
      ariaLabel={`${label} unit`} onChange={(u) => setStageUnit(stage, u)} />
    {#if beats === undefined}
      <!-- The value alone, as Sustain's is: drag it, or click it and type the exact value. -->
      <FaceParamControl kind="number" value={ms} display={formatMs(ms)} min={0} step={1}
        ariaLabel={label} entry={{ unit: 'ms' }} {disabled} onGestureStart={begin} onGestureEnd={end}
        onChange={(v) => api.setAmp(effect.id, { [msKey]: Math.max(0, num(v)) })} />
    {:else}
      <FaceParamControl kind="number" value={beats} display={beatsLabel(beats)} min={0} step={0.0625}
        ariaLabel={`${label} beats`} entry={{ unit: 'beats' }} {disabled} onGestureStart={begin} onGestureEnd={end}
        onChange={(v) => api.setAmp(effect.id, { [beatsKey]: Math.max(0, num(v)) })} />
    {/if}
  </ParamLine>
{/snippet}

{#snippet info(text: string, label: string)}
  <Tooltip {text} side="top">
    <span class="info" aria-label={`About ${label}`}><Info size={11} aria-hidden="true" /></span>
  </Tooltip>
{/snippet}

<div class="amp" role="group" aria-label="Brightness envelope">
  <div class="head">
    <span class="title">Brightness envelope</span>
  </div>
  <svg class="shape" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
    <path d={path} />
  </svg>

  {@render stageRow('attack', 'Attack', amp.attackMs)}

  <div class="curve">
    <span class="k">Curve {@render info(CURVE_INFO, 'Curve')}</span>
    <EasePicker value={amp.attackEase ?? { fn: 'linear', dir: 'in' }} {disabled} ariaLabel="Attack curve" onChange={setCurve} />
  </div>

  {#if legacyDrop}
    <ParamLine label="Drop">
      <FaceParamControl kind="number" value={amp.decayMs} display={formatMs(amp.decayMs)} min={0} max={2000} step={1}
        ariaLabel="Drop time" {disabled} onGestureStart={begin} onGestureEnd={end}
        onChange={(v) => api.setAmp(effect.id, { decayMs: Math.max(0, num(v)) })} />
    </ParamLine>
    <ParamLine label="Drop to">
      <FaceParamControl kind="number" value={amp.sustainLevel} display={percent(amp.sustainLevel)} min={0} max={1} step={0.01}
        ariaLabel="Drop to level" {disabled} onGestureStart={begin} onGestureEnd={end}
        onChange={(v) => api.setAmp(effect.id, { sustainLevel: Math.min(1, Math.max(0, num(v))) })} />
      {@render info(DROP_INFO, 'Drop')}
    </ParamLine>
  {/if}

  {#if always}
    <ParamLine label="Sustain"><span class="fixed">Loop</span></ParamLine>
  {:else}
    <!-- The sustain value rides the same line as its mode: the field alone (no rail), so both fit
         the card width and the face never needs to scroll for it. -->
    <ParamLine label="Sustain">
      <Select value={mode} options={lengthOptions} onChange={setMode} ariaLabel="Sustain" {disabled} segment={false} />
      {#if typeof amp.length === 'object' && 'ms' in amp.length}
        {@const ms = amp.length.ms}
        <FaceParamControl kind="number" value={ms} display={formatMs(ms)} min={0} step={10}
          ariaLabel="Sustain time" entry={{ unit: 'ms' }} {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { ms: Math.max(0, num(v)) } })} />
      {:else if typeof amp.length === 'object'}
        {@const beats = amp.length.beats}
        <FaceParamControl kind="number" value={beats} display={beatsLabel(beats)} min={0} step={0.0625}
          ariaLabel="Sustain beats" entry={{ unit: 'beats' }} {disabled} onGestureStart={begin} onGestureEnd={end}
          onChange={(v) => api.setAmp(effect.id, { length: { beats: Math.max(0, num(v)) } })} />
      {/if}
      {@render info(SUSTAIN_INFO, 'Sustain')}
    </ParamLine>
  {/if}

  {@render stageRow('release', 'Decay', amp.releaseMs)}
</div>

<style>
  .amp {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .head {
    display: flex;
    align-items: center;
    min-height: 18px;
  }
  .title {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .shape {
    width: 100%;
    height: 24px;
    margin-bottom: 2px;
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
  .curve {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0;
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .info {
    display: inline-flex;
    flex: none;
    color: var(--text-faint);
  }
  /* The family names (Linear, Elastic…) need more room than the In / Out / In·Out segments. */
  /* Family over direction: the card is too narrow for both on one line. */
  .curve :global(.ease-picker) {
    flex-wrap: wrap;
    gap: 4px;
  }
  .curve :global(.ease-family),
  .curve :global(.ease-dir) {
    flex: 1 1 100%;
    min-width: 0;
  }
  .fixed {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
</style>
