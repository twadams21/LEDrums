<script lang="ts">
  /* Audio input surface (GH #214) — Settings › Input › Audio input. The answer to "is signal
     arriving, and how do I route Ableton into it?":

       1. pick an input (labels appear once the browser has granted permission),
       2. Enable — the ONLY thing that ever opens the input; Stop releases it and zeros features,
       3. read the truth: a compact status pill with actionable copy for every non-running state,
          and four meters proving energy is arriving before anything is mapped,
       4. shape the analysis: gain, noise floor, attack/release — local preferences, not show data.

     Presentational apart from reading the store's audio controller state; every mutation goes
     through the store's `startAudio` / `stopAudio` / `setAudioDevice` / `setAudioSettings`. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import Slider from '../../ui/Slider.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import LevelMeter from '../../ui/LevelMeter.svelte';
  import { AUDIO_BAND_LABELS } from '../../audio/band-labels';
  import { AUDIO_GAIN_RANGE, AUDIO_NOISE_FLOOR_RANGE, AUDIO_SMOOTHING_RANGE } from '../../audio/analysis';
  import { voice } from '@ledrums/core';

  let { store }: { store: TriggerLab } = $props();

  const status = $derived(store.audioStatus);
  const running = $derived(status === 'running');
  const busy = $derived(status === 'starting');
  const supported = $derived(store.audioSupported);
  const canControl = $derived(supported && store.canEdit);
  const meter = $derived(store.audioMeter);
  const settings = $derived(store.audioSettings);

  const DEFAULT_ID = '__default__';
  const deviceOptions = $derived([
    { value: DEFAULT_ID, label: 'Default input' },
    ...store.audioDevices.map((d, i) => ({ value: d.id, label: d.label || `Input ${i + 1}` })),
  ]);
  const deviceValue = $derived(store.audioDeviceId ?? DEFAULT_ID);
  /** Names are hidden until permission has been granted once — say so instead of listing "Input 1". */
  const unnamed = $derived(store.audioDevices.length > 0 && store.audioDevices.every((d) => !d.label));

  const unsupportedCopy = $derived.by(() => {
    switch (store.audioUnsupportedReason) {
      case 'insecure-context':
        return 'Audio capture needs a secure page — open the app over https or on localhost.';
      case 'no-media-devices':
        return 'This browser exposes no audio inputs (getUserMedia is unavailable).';
      case 'no-audio-context':
        return 'Web Audio is unavailable in this browser.';
      default:
        return 'Audio capture is unavailable here.';
    }
  });

  /** One truthful pill per state + the copy that tells the operator what to do next. */
  const state = $derived.by((): { tone: 'ok' | 'warn' | 'live' | 'accent' | 'muted'; label: string; pulse?: boolean; help?: string } => {
    if (!supported) return { tone: 'muted', label: 'Unavailable', help: unsupportedCopy };
    switch (status) {
      case 'starting':
        return { tone: 'accent', label: 'Starting…', pulse: true };
      case 'running':
        return { tone: 'ok', label: 'Running' };
      case 'suspended':
        return { tone: 'warn', label: 'Paused by browser', help: 'The browser suspended audio. Return to this tab or press Enable again.' };
      case 'device-lost':
        return { tone: 'live', label: 'Input lost', help: 'The selected input went away. Pick another input, then Enable.' };
      case 'error':
        switch (store.audioError) {
          case 'permission-denied':
            return { tone: 'live', label: 'Permission denied', help: 'Allow microphone access for this app in the browser or macOS Privacy settings, then Enable again.' };
          case 'no-device':
            return { tone: 'live', label: 'No input found', help: 'No audio input matched. Plug one in or choose Default input, then Enable.' };
          case 'unsupported':
            return { tone: 'muted', label: 'Unavailable', help: unsupportedCopy };
          default:
            return { tone: 'live', label: 'Failed', help: store.audioMessage || 'Capture failed to start. Try again.' };
        }
      default:
        return { tone: 'muted', label: 'Off' };
    }
  });

  const detail = $derived(
    running && store.audioTrackLabel
      ? `${store.audioTrackLabel}${store.audioSampleRate ? ` · ${Math.round(store.audioSampleRate / 100) / 10} kHz` : ''}`
      : null,
  );

  function onDevice(v: string): void {
    store.setAudioDevice(v === DEFAULT_ID ? null : v);
  }
  function toggle(): void {
    if (running || busy) store.stopAudio();
    else void store.startAudio();
  }
  const dbFmt = (v: number): string => `${Math.round(v)} dB`;
  const msFmt = (v: number): string => `${Math.round(v)} ms`;
  const gainFmt = (v: number): string => (v <= 0 ? '−∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
</script>

<section class="audio" aria-label="Audio input">
  <span class="alabel">
    Audio input<em class="ahint">{running ? 'analysed locally · not recorded' : 'level · bass · mids · highs'}</em>
  </span>

  <div class="head">
    <Field label="Input" class="device" info={unnamed ? 'Device names appear after the first Enable grants permission.' : undefined}>
      <Select
        value={deviceValue}
        options={deviceOptions}
        onChange={onDevice}
        disabled={!canControl}
        segment={false}
        ariaLabel="Audio input device"
      />
    </Field>
    <button
      type="button"
      class={running || busy ? undefined : 'primary'}
      disabled={!canControl}
      aria-pressed={running}
      onclick={toggle}
    >{running || busy ? 'Stop' : 'Enable'}</button>
  </div>

  <div class="foot">
    <StatusPill tone={state.tone} label={state.label} pulse={state.pulse} />
    {#if detail}<span class="note faint">{detail}</span>{/if}
    {#if !store.canEdit}<span class="note faint">Viewers can't capture — the host owns audio.</span>{/if}
  </div>
  {#if state.help}
    <div class="fault" role={state.tone === 'live' ? 'alert' : 'status'} class:soft={state.tone !== 'live'}>
      <TriangleAlert size={14} class="fault-glyph" aria-hidden="true" />
      <p class="fault-msg">{state.help}</p>
    </div>
  {/if}

  <div class="meters" aria-label="Audio feature meters">
    {#each voice.AUDIO_BANDS as band (band)}
      <LevelMeter label={AUDIO_BAND_LABELS[band]} value={meter[band]} muted={!running} />
    {/each}
  </div>

  <div class="controls">
    <Field label="Gain" layout="row" info="Linear input gain before the noise floor. Unity is 0 dB.">
      <Slider
        value={settings.gain}
        min={AUDIO_GAIN_RANGE[0]}
        max={AUDIO_GAIN_RANGE[1]}
        step={0.05}
        notchAt={1}
        onChange={(v) => store.setAudioSettings({ gain: v })}
        format={gainFmt}
        disabled={!supported}
        ariaLabel="Audio gain"
      />
    </Field>
    <Field label="Noise floor" layout="row" info="Everything below this level reads 0 — raise it so room noise stays silent.">
      <Slider
        value={settings.noiseFloorDb}
        min={AUDIO_NOISE_FLOOR_RANGE[0]}
        max={AUDIO_NOISE_FLOOR_RANGE[1]}
        step={1}
        onChange={(v) => store.setAudioSettings({ noiseFloorDb: v })}
        format={dbFmt}
        disabled={!supported}
        ariaLabel="Audio noise floor"
      />
    </Field>
    <Field label="Attack" layout="row" info="How fast the features rise.">
      <Slider
        value={settings.attackMs}
        min={AUDIO_SMOOTHING_RANGE[0]}
        max={AUDIO_SMOOTHING_RANGE[1]}
        step={1}
        onChange={(v) => store.setAudioSettings({ attackMs: v })}
        format={msFmt}
        disabled={!supported}
        ariaLabel="Audio attack"
      />
    </Field>
    <Field label="Release" layout="row" info="How fast the features fall.">
      <Slider
        value={settings.releaseMs}
        min={AUDIO_SMOOTHING_RANGE[0]}
        max={AUDIO_SMOOTHING_RANGE[1]}
        step={1}
        onChange={(v) => store.setAudioSettings({ releaseMs: v })}
        format={msFmt}
        disabled={!supported}
        ariaLabel="Audio release"
      />
    </Field>
  </div>

  <p class="note">
    Route Ableton to an audio-interface loopback or virtual input, then select it here. Audio is
    analysed locally; it is not recorded.
  </p>
</section>

<style>
  .audio {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  /* Matches Field's label styling so the section sits in the dialog's rhythm. */
  .alabel {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .ahint {
    font-style: normal;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .head {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    min-width: 0;
  }
  .head :global(.device) {
    flex: 1;
    min-width: 0;
  }
  .head button {
    flex: none;
    min-width: 72px;
    justify-content: center;
    min-height: 30px;
  }
  .foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-height: 22px;
  }
  .note {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .faint {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
  }
  .fault {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-2);
    border: 1px solid color-mix(in oklch, var(--live) 45%, transparent);
    background: var(--live-soft);
    color: var(--text);
  }
  .fault.soft {
    border-color: var(--border-faint);
    background: var(--surface-inset);
  }
  .fault :global(.fault-glyph) {
    flex: none;
    margin-top: 1px;
    color: var(--live-bright);
  }
  .fault.soft :global(.fault-glyph) {
    color: var(--text-muted);
  }
  .fault-msg {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.4;
    text-wrap: pretty;
  }
  .meters {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
