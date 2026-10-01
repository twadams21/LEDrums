<script lang="ts">
  /* Trigger card — everything about WHEN the Effect fires, on one face (spec stories 25–31):
     the trigger kind (switching it moves the Effect to that column of its row, so the grid and
     the chain never disagree), the kind's settings, and the Effect's amp envelope.

     - Zone: the zone is the cell's, shown read-only (move the Effect in the grid to change it).
     - Clock: the period (beat / bar divisions) and an offset in beats.
     - Cue: MIDI note / CC / OSC address, typed or learned (the store's cue learn).

     Every param sits on the face at the fixed device height: nothing here scrolls. */
  import type { Component } from 'svelte';
  import type { effectChain } from '@ledrums/core';
  import Drum from '@lucide/svelte/icons/drum';
  import InfinityIcon from '@lucide/svelte/icons/infinity';
  import Clock from '@lucide/svelte/icons/clock';
  import Radio from '@lucide/svelte/icons/radio';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import Select from '../../../../ui/Select.svelte';
  import CommitInput from '../../../../ui/CommitInput.svelte';
  import LearnButton from '../../../../ui/LearnButton.svelte';
  import Tooltip from '../../../../ui/Tooltip.svelte';
  import FaceParamControl from '../../../../ui/FaceParamControl.svelte';
  import DeviceCard from './DeviceCard.svelte';
  import ParamLine from './ParamLine.svelte';
  import AmpEnvelopeField from './AmpEnvelopeField.svelte';
  import {
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

<DeviceCard
  title="Trigger"
  tint="var(--role-input)"
  icon={KIND_ICON[trigger.kind]}
  class="trigger-card"
  selected={api.selectedDevice?.kind === 'stage' && api.selectedDevice.effectId === effect.id && api.selectedDevice.stage === 'trigger'}
  onSelect={() => api.selectDevice({ kind: 'stage', effectId: effect.id, stage: 'trigger' })}
  onDeselect={() => api.selectDevice(null)}
>
  <!-- A dropdown, not segments: four kinds do not fit a card-width segmented row legibly. -->
  <ParamLine label="Kind">
    <Select value={trigger.kind} options={kindOptions} onChange={setKind} ariaLabel="Trigger kind" {disabled} segment={false} />
  </ParamLine>

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
    <!-- Note and CC share one line (and one Learn) so the card face fits every kind without
         scrolling; the label keeps their order readable once both hold numbers. -->
    <ParamLine label="Note / CC">
      <CommitInput type="number" min={0} max={127} value={source.midiNote ?? ''} placeholder="note" ariaLabel="Cue MIDI note"
        class="cue-num" {disabled} onCommit={(v) => commitMidi('midiNote', v)} />
      <CommitInput type="number" min={0} max={127} value={source.midiCc ?? ''} placeholder="CC" ariaLabel="Cue MIDI CC"
        class="cue-num" {disabled} onCommit={(v) => commitMidi('midiCc', v)} />
      <Tooltip text={learning('midi') ? 'Listening for MIDI — click to cancel' : 'Learn MIDI'}>
        <LearnButton armed={learning('midi')} onclick={() => toggleLearn('midi')} {disabled} ariaLabel="Learn cue MIDI" />
      </Tooltip>
    </ParamLine>
    <ParamLine label="OSC">
      <CommitInput value={source.oscAddress ?? ''} placeholder="/address" mono autofocus={false} allowEmpty ariaLabel="Cue OSC address"
        class="cue-osc" {disabled} onCommit={(v) => setCue({ oscAddress: v.trim() || undefined })} />
      <Tooltip text={learning('osc') ? 'Listening for OSC — click to cancel' : 'Learn OSC'}>
        <LearnButton armed={learning('osc')} onclick={() => toggleLearn('osc')} {disabled} ariaLabel="Learn cue OSC" />
      </Tooltip>
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
  /* The densest face in the strip: every kind's params plus the amp envelope must fit the fixed
     device height without scrolling, so its lines, controls and gaps run a step tighter. */
  :global(.trigger-card) {
    --line-h: 22px;
    --control-h: 22px;
    --face-gap: var(--space-1_5);
  }
  :global(.trigger-card .cue-num) {
    width: 3rem;
    flex: none;
    padding: 0 var(--space-1_5);
  }
  /* No native spinners: they eat the width a 3-digit MIDI number needs (drag/type instead). */
  :global(.trigger-card .cue-num input) {
    appearance: textfield;
  }
  :global(.trigger-card .cue-num input::-webkit-inner-spin-button),
  :global(.trigger-card .cue-num input::-webkit-outer-spin-button) {
    margin: 0;
    appearance: none;
  }
  /* Learn goes icon-only here (the Tooltip names it; the armed icon still pulses), so two
     numbers and the button share one card-width line. */
  :global(.trigger-card .learn) {
    width: 22px;
    height: 22px;
    flex: none;
    gap: 0;
    padding: 0;
    font-size: 0;
  }
  :global(.trigger-card .cue-osc) {
    min-width: 0;
    flex: 1;
  }
</style>
