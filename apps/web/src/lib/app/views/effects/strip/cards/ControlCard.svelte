<script lang="ts">
  /* The Control device card: a modulation source (Envelope / LFO / Velocity / Random / CC /
     OSC / Note / Audio) and the params it drives. Top: the kind's own settings. Bottom: the
     mappings list — each row names its target ("Wave · Speed") with amount, invert and an
     optional range; "Map to…" adds one by picking any numeric param of any device in this
     Effect. The targets' own cards show the modulated badge, so the link reads both ways. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import FaceParamControl from '../../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import CommitInput from '../../../../../ui/CommitInput.svelte';
  import IconButton from '../../../../../ui/IconButton.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
  import X from '@lucide/svelte/icons/x';
  import DeviceCard from './DeviceCard.svelte';
  import ParamRows from './ParamRows.svelte';
  import { CONTROL_ICON } from './device-icons';
  import {
    AUDIO_BAND_OPTIONS,
    CHANNEL_OPTIONS,
    CONTROL_KIND_LABEL,
    DIVISION_OPTIONS,
    ENVELOPE_SHAPE_OPTIONS,
    LFO_RATE_MODE_OPTIONS,
    LFO_WAVEFORM_OPTIONS,
    NOTE_MODE_OPTIONS,
    RANDOM_DISTRIBUTION_OPTIONS,
    channelFromValue,
    channelValue,
    describeMapping,
    envelopePoints,
    envelopePolyline,
    envelopeShapeOf,
    mapTargetKey,
    mappingTargets,
    newMapping,
    parseMapTargetKey,
    pct,
    type CardParam,
    type EnvelopeShape,
    type ParamValue,
  } from './card-model';

  type ControlDevice = effectChain.ControlDevice;
  type ControlMapping = effectChain.ControlMapping;
  type Settings = Partial<ControlDevice['settings']>;

  interface Props {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
    control: ControlDevice;
  }

  let { api, effect, control }: Props = $props();

  const label = $derived(CONTROL_KIND_LABEL[control.kind]);
  const disabled = $derived(!api.canEdit);
  const targets = $derived(mappingTargets(effect));
  const mapOptions = $derived(targets.map((t) => ({ value: mapTargetKey(t.device, t.param), label: t.label })));

  const begin = (): void => api.beginGesture();
  const end = (): void => api.endGesture();
  const set = (s: Settings): void => api.setControlSettings(effect.id, control.uid, s);

  // Numeric settings per kind, rendered through the shared param rows.
  const n = (key: string, lbl: string, def: number, min: number, max: number, step: number, unit?: string): CardParam => ({
    key, label: lbl, kind: 'number', default: def, min, max, step, ...(unit ? { unit } : {}),
  });
  const numericSettings = $derived.by((): CardParam[] => {
    switch (control.kind) {
      case 'lfo':
        return [
          ...(control.settings.rateMode === 'hz' ? [n('rateHz', 'Rate', 1, 0, 20, 0.01, 'Hz')] : []),
          n('phase', 'Phase', 0, 0, 1, 0.01),
        ];
      case 'random':
        return control.settings.distribution === 'stepped' ? [n('steps', 'Steps', 4, 2, 64, 1)] : [];
      case 'cc':
        return [n('controller', 'Controller', 1, 0, 127, 1)];
      case 'note':
        return [n('note', 'Note', 60, 0, 127, 1), n('releaseMs', 'Release', 0, 0, 5000, 1, 'ms')];
      default:
        return [];
    }
  });

  const envShape = $derived(control.kind === 'envelope' ? envelopeShapeOf(control.settings.points) : 'decay');

  // "Map to…" is an action picker: re-key it after each pick so it returns to its placeholder.
  let pickerKey = $state(0);
  function addMapping(key: string): void {
    const at = parseMapTargetKey(key);
    const t = at && targets.find((x) => x.device === at.device && x.param === at.param);
    if (t) api.addMapping(effect.id, control.uid, newMapping(t));
    pickerKey += 1;
  }
  const setMapping = (i: number, m: Partial<ControlMapping>): void => api.setMapping(effect.id, control.uid, i, m);

  /* The range ends are drag fields without rails (two rails side by side don't fit a card), so
     the field is unbounded and the clamp to the target's own range happens here. */
  const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

  const targetOf = (m: ControlMapping) => targets.find((t) => t.device === m.device && t.param === m.param);
</script>

<DeviceCard
  role="control"
  icon={CONTROL_ICON[control.kind]}
  title={label}
  eyebrow="Control"
  {disabled}
  selected={api.selectedDevice?.kind === 'control' && api.selectedDevice.effectId === effect.id && api.selectedDevice.uid === control.uid}
  onSelect={() => api.selectDevice({ kind: 'control', effectId: effect.id, uid: control.uid })}
>
  {#snippet actions()}
    <IconButton icon={Trash2} label={`Remove ${label}`} size={14} {disabled} onclick={() => api.removeControl(effect.id, control.uid)} />
  {/snippet}

  <div class="settings">
    {#if control.kind === 'envelope'}
      <svg class="envplot" viewBox="0 0 232 36" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={envelopePolyline(control.settings.points, 232, 36)} />
      </svg>
      <div class="field">
        <span class="flabel">Shape</span>
        <Select
          value={envShape}
          options={envShape === 'custom' ? [...ENVELOPE_SHAPE_OPTIONS, { value: 'custom', label: 'Custom', disabled: true }] : ENVELOPE_SHAPE_OPTIONS}
          segment={false}
          {disabled}
          ariaLabel="Envelope shape"
          onChange={(v) => set({ points: envelopePoints(v as EnvelopeShape) })}
          class="fsel"
        />
      </div>
    {:else if control.kind === 'lfo'}
      <div class="field">
        <span class="flabel">Wave</span>
        <Select value={control.settings.waveform} options={LFO_WAVEFORM_OPTIONS} segment={false} {disabled} ariaLabel="LFO waveform" onChange={(v) => set({ waveform: v as never })} class="fsel" />
      </div>
      <div class="field">
        <span class="flabel">Rate mode</span>
        <Select value={control.settings.rateMode} options={LFO_RATE_MODE_OPTIONS} {disabled} ariaLabel="LFO rate mode" onChange={(v) => set({ rateMode: v as 'hz' | 'beats' })} class="fsel" />
      </div>
      {#if control.settings.rateMode === 'beats'}
        <div class="field">
          <span class="flabel">Rate</span>
          <Select value={control.settings.division} options={DIVISION_OPTIONS} segment={false} {disabled} ariaLabel="LFO division" onChange={(v) => set({ division: v })} class="fsel" />
        </div>
      {/if}
    {:else if control.kind === 'velocity'}
      <p class="hint">The hit's velocity, 0 to 1. Soft hits give low values and hard hits give high ones.</p>
    {:else if control.kind === 'random'}
      <div class="field">
        <span class="flabel">Distribution</span>
        <Select value={control.settings.distribution} options={RANDOM_DISTRIBUTION_OPTIONS} segment={false} {disabled} ariaLabel="Random distribution" onChange={(v) => set({ distribution: v as never })} class="fsel" />
      </div>
      <p class="hint">Picks a new value on every hit.</p>
    {:else if control.kind === 'cc' || control.kind === 'note'}
      <div class="field">
        <span class="flabel">Channel</span>
        <Select
          value={channelValue(control.settings.channel)}
          options={CHANNEL_OPTIONS}
          segment={false}
          {disabled}
          ariaLabel="MIDI channel"
          onChange={(v) => set({ channel: channelFromValue(v) })}
          class="fsel"
        />
      </div>
      {#if control.kind === 'note'}
        <div class="field">
          <span class="flabel">Output</span>
          <Select value={control.settings.mode} options={NOTE_MODE_OPTIONS} {disabled} ariaLabel="Note output" onChange={(v) => set({ mode: v as 'gate' | 'velocity' })} class="fsel" />
        </div>
      {/if}
    {:else if control.kind === 'osc'}
      <div class="field">
        <span class="flabel">Address</span>
        <CommitInput
          value={control.settings.address}
          placeholder="/ledrums/…"
          mono
          autofocus={false}
          allowEmpty
          {disabled}
          ariaLabel="OSC address"
          onCommit={(v: string) => set({ address: v.trim() })}
          class="fsel"
        />
      </div>
    {:else if control.kind === 'audio'}
      <div class="field">
        <span class="flabel">Band</span>
        <Select value={control.settings.band} options={AUDIO_BAND_OPTIONS} {disabled} ariaLabel="Audio band" onChange={(v) => set({ band: v as never })} class="fsel" />
      </div>
    {/if}

    <ParamRows
      params={numericSettings}
      values={control.settings as Record<string, ParamValue>}
      {disabled}
      labelPrefix={label}
      onChange={(key, v) => set({ [key]: v } as Settings)}
      onGestureStart={begin}
      onGestureEnd={end}
    />
  </div>

  <section class="maps" aria-label={`${label} mappings`}>
    <div class="mapshead">
      <span class="mapstitle">Maps to</span>
      <span class="count">{control.mappings.length}</span>
    </div>
    {#if control.mappings.length === 0}
      <p class="hint">Not mapped yet. Pick a parameter below to drive it.</p>
    {/if}
    <ul class="maplist">
      {#each control.mappings as m, i (`${m.device}:${m.param}:${i}`)}
        {@const t = targetOf(m)}
        <li class="map" class:missing={!t}>
          <div class="maphead">
            <span class="target" title={describeMapping(effect, m, targets)}>{describeMapping(effect, m, targets)}</span>
            <Tooltip text={m.invert ? 'Inverted: high input lowers the value' : 'Invert'}>
              <button
                type="button"
                class="inv"
                class:on={m.invert}
                aria-pressed={m.invert}
                aria-label="Invert mapping"
                {disabled}
                onclick={() => setMapping(i, { invert: !m.invert })}
              >
                <ArrowDownUp size={12} aria-hidden="true" />
              </button>
            </Tooltip>
            <IconButton icon={X} label="Remove mapping" size={13} {disabled} onclick={() => api.removeMapping(effect.id, control.uid, i)} />
          </div>
          <div class="maprow">
            <span class="mlabel">Amount</span>
            <FaceParamControl
              kind="number"
              value={m.amount}
              display={pct(m.amount)}
              min={0}
              max={1}
              step={0.01}
              {disabled}
              ariaLabel="Mapping amount"
              onChange={(v) => setMapping(i, { amount: Number(v) })}
              onGestureStart={begin}
              onGestureEnd={end}
            />
          </div>
          {#if t}
            {@const step = t.max - t.min > 10 ? 1 : 0.01}
            {@const fmtR = (v: number) => (step < 1 ? v.toFixed(2) : String(Math.round(v)))}
            <div class="maprow">
              <span class="mlabel">Range</span>
              <span class="range">
                <FaceParamControl
                  kind="number"
                  value={m.rangeMin ?? t.min}
                  display={fmtR(m.rangeMin ?? t.min)}
                  {step}
                  {disabled}
                  ariaLabel="Mapping range low"
                  onChange={(v) => setMapping(i, { rangeMin: clampTo(Number(v), t.min, t.max) })}
                  onGestureStart={begin}
                  onGestureEnd={end}
                />
                <FaceParamControl
                  kind="number"
                  value={m.rangeMax ?? t.max}
                  display={fmtR(m.rangeMax ?? t.max)}
                  {step}
                  {disabled}
                  ariaLabel="Mapping range high"
                  onChange={(v) => setMapping(i, { rangeMax: clampTo(Number(v), t.min, t.max) })}
                  onGestureStart={begin}
                  onGestureEnd={end}
                />
              </span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#key pickerKey}
      <Select
        value=""
        options={mapOptions}
        segment={false}
        disabled={disabled || mapOptions.length === 0}
        placeholder={mapOptions.length ? 'Map to…' : 'Nothing to map'}
        ariaLabel={`Map ${label} to a parameter`}
        onChange={addMapping}
        class="mappick"
      />
    {/key}
  </section>
</DeviceCard>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 26px;
  }
  .flabel,
  .mlabel {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .field :global(.fsel) {
    width: 132px;
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-snug);
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .envplot {
    width: 100%;
    height: 36px;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
  }
  .envplot polyline {
    fill: none;
    stroke: var(--role-mod);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .maps {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    padding-top: var(--space-1_5);
    box-shadow: inset 0 1px 0 0 var(--border-faint);
  }
  .mapshead {
    display: flex;
    align-items: center;
    gap: var(--space-1_5);
  }
  .mapstitle {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .count {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .maplist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .map {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-1_5) var(--space-1_5);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    box-shadow: inset 2px 0 0 0 var(--role-modulation);
  }
  .map.missing {
    box-shadow: inset 2px 0 0 0 var(--warn);
  }
  .maphead {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .target {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text);
  }
  .map.missing .target {
    color: var(--warn);
  }
  .inv {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    line-height: 0;
  }
  .inv:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .inv.on {
    color: var(--role-modulation);
  }
  .inv:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .inv:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .maprow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 22px;
  }
  .range {
    display: inline-flex;
    gap: var(--space-1);
  }
  .maps :global(.mappick) {
    width: 100%;
  }
</style>
