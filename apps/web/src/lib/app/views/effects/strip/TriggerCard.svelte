<script lang="ts">
  /* Trigger card — everything about WHEN the Effect fires, on one face (spec stories 25–31):
     the trigger kind (switching it moves the Effect to that column of its row, so the grid and
     the chain never disagree), the kind's settings, and the Effect's amp envelope.

     - Zone: the zone is the cell's, shown read-only (move the Effect in the grid to change it).
     - Clock: the period (beat / bar divisions) and an offset in beats.
     - Cue: MIDI note / CC / OSC address, typed or learned (the store's cue learn). */
  import type { Component } from 'svelte';
  import type { effectChain } from '@ledrums/core';
  import Drum from '@lucide/svelte/icons/drum';
  import InfinityIcon from '@lucide/svelte/icons/infinity';
  import Clock from '@lucide/svelte/icons/clock';
  import Radio from '@lucide/svelte/icons/radio';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import SegmentedControl from '../../../../ui/SegmentedControl.svelte';
  import Select from '../../../../ui/Select.svelte';
  import CommitInput from '../../../../ui/CommitInput.svelte';
  import LearnButton from '../../../../ui/LearnButton.svelte';
  import FaceParamControl from '../../../../ui/FaceParamControl.svelte';
  import DeviceCard from './DeviceCard.svelte';
  import ParamLine from './ParamLine.svelte';
  import AmpEnvelopeField from './AmpEnvelopeField.svelte';
  import {
    TRIGGER_KIND_LABEL,
    clockEveryFromValue,
    clockEveryOptions,
    clockEveryValue,
    defaultTrigger,
    parseMidi,
    triggerKindOptions,
  } from './strip-model';

  type Effect = effectChain.Effect;
  type Trigger = effectChain.EffectTrigger;
  type CueSource = effectChain.CueSource;

  let { api, effect }: { api: EffectsAuthoringApi; effect: Effect } = $props();

  const KIND_ICON: Record<Trigger['kind'], Component> = { zone: Drum, always: InfinityIcon, clock: Clock, cue: Radio };

  const trigger = $derived(effect.trigger);
  const disabled = $derived(!api.canEdit);
  const kindOptions = $derived(triggerKindOptions(effect.cell.row));
  const zoneLabel = $derived(effect.cell.column.kind === 'zone' ? api.cellSummary(effect.cell).label : '');

  /** Which learn button was pressed here — the api says only WHICH Effect is learning. */
  let learnVia = $state<'midi' | 'osc' | null>(null);
  function learning(via: 'midi' | 'osc'): boolean {
    return api.cueLearnEffectId === effect.id && (learnVia ?? via) === via;
  }
  function toggleLearn(via: 'midi' | 'osc'): void {
    if (learning(via)) {
      api.cancelCueLearn();
      learnVia = null;
      return;
    }
    learnVia = via;
    api.startCueLearn(effect.id, via);
  }

  function setKind(kind: string): void {
    if (kind === trigger.kind) return;
    api.setTrigger(effect.id, defaultTrigger(kind as Trigger['kind']));
  }

  function setCue(patch: Partial<CueSource>): void {
    if (trigger.kind !== 'cue') return;
    const source: CueSource = { ...trigger.source, ...patch };
    for (const key of Object.keys(source) as (keyof CueSource)[]) if (source[key] === undefined) delete source[key];
    api.setTrigger(effect.id, { kind: 'cue', source });
  }

  function commitMidi(key: 'midiNote' | 'midiCc', raw: string): void {
    const n = parseMidi(raw);
    if (n !== null) setCue({ [key]: n });
  }
</script>

<DeviceCard title={TRIGGER_KIND_LABEL[trigger.kind]} tint="var(--role-input)" icon={KIND_ICON[trigger.kind]} class="trigger-card">
  <SegmentedControl value={trigger.kind} options={kindOptions} onChange={setKind} ariaLabel="Trigger kind" {disabled} />

  {#if trigger.kind === 'zone'}
    <ParamLine label="Zone"><span class="read">{zoneLabel}</span></ParamLine>
  {:else if trigger.kind === 'always'}
    <p class="note">Runs while the section is active.</p>
  {:else if trigger.kind === 'clock'}
    {@const every = trigger.every}
    <ParamLine label="Every">
      <Select
        value={clockEveryValue(every)}
        options={clockEveryOptions(every)}
        ariaLabel="Clock period"
        {disabled}
        onChange={(v) => {
          const next = clockEveryFromValue(v);
          if (next) api.setTrigger(effect.id, { ...trigger, every: next });
        }}
      />
    </ParamLine>
    <ParamLine label="Offset">
      <FaceParamControl
        kind="number"
        value={trigger.offsetBeats}
        display={`${trigger.offsetBeats} bt`}
        min={0}
        max={16}
        step={0.25}
        ariaLabel="Clock offset in beats"
        {disabled}
        onGestureStart={() => api.beginGesture()}
        onGestureEnd={() => api.endGesture()}
        onChange={(v) => api.setTrigger(effect.id, { ...trigger, offsetBeats: Number(v) })}
      />
    </ParamLine>
  {:else}
    {@const source = trigger.source}
    <ParamLine label="MIDI note">
      <CommitInput type="number" min={0} max={127} value={source.midiNote ?? ''} placeholder="—" ariaLabel="Cue MIDI note"
        class="cue-num" {disabled} onCommit={(v) => commitMidi('midiNote', v)} />
      <LearnButton armed={learning('midi')} onclick={() => toggleLearn('midi')} {disabled} ariaLabel="Learn cue MIDI" />
    </ParamLine>
    <ParamLine label="MIDI CC">
      <CommitInput type="number" min={0} max={127} value={source.midiCc ?? ''} placeholder="—" ariaLabel="Cue MIDI CC"
        class="cue-num" {disabled} onCommit={(v) => commitMidi('midiCc', v)} />
    </ParamLine>
    <ParamLine label="OSC">
      <CommitInput value={source.oscAddress ?? ''} placeholder="/address" mono autofocus={false} allowEmpty ariaLabel="Cue OSC address"
        class="cue-osc" {disabled} onCommit={(v) => setCue({ oscAddress: v.trim() || undefined })} />
      <LearnButton armed={learning('osc')} onclick={() => toggleLearn('osc')} {disabled} ariaLabel="Learn cue OSC" />
    </ParamLine>
  {/if}

  <div class="rule" aria-hidden="true"></div>
  <AmpEnvelopeField {api} {effect} />
</DeviceCard>

<style>
  .read {
    overflow: hidden;
    color: var(--ink);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    text-wrap: pretty;
  }
  .rule {
    height: 1px;
    flex: none;
    background: var(--border-faint);
  }
  :global(.trigger-card .cue-num) {
    width: 3.5rem;
  }
  :global(.trigger-card .cue-osc) {
    min-width: 0;
    flex: 1;
  }
</style>
