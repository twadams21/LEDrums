<script lang="ts">
  /* Settings › Input (S4e) — everything that fires the rig, per the S4a pane spec:
     MIDI input (channel filter + device list, from General), the OSC input panel
     and global control bindings (reused wholesale), then the per-drum zone→input
     wiring — DrumZonesList reused wholesale, one list per drum, the same list +
     `setInputMap` mutation path the Trigger-graph source editor uses. The zone
     lists carry no gating of their own (in the Inspector a fieldset gates them),
     so the same natively-disabled-fieldset treatment wraps them here; the OSC /
     global-controls panels stay outside it — they self-gate, and a viewer keeps
     the copyable OSC addresses. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import Separator from '../../../ui/Separator.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import { midiChannelOptions } from '../../../midi/midi-note';
  import { deviceListEmptyState } from '../../chrome/midi-devices';
  import GlobalControlsPanel from '../../chrome/GlobalControlsPanel.svelte';
  import OscInputPanel from '../../chrome/OscInputPanel.svelte';
  import DrumZonesList from '../../docks/inspectors/DrumZonesList.svelte';
  import { patchLabel } from '../../docks/inspectors/forms';
  import { drumZoneId } from '../../patch-zones';

  let { store }: { store: TriggerLab } = $props();

  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const midiEmpty = $derived(
    deviceListEmptyState(store.midiAvailable, store.midiUnavailableReason, store.midiDevices.length),
  );
  const CHANNEL_OPTS = midiChannelOptions();

  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
  }
</script>

<div class="pane-body">
  <h3>Input</h3>

  <Eyebrow>MIDI input</Eyebrow>
  <Field label="MIDI channel" hint="input filter">
    <Select
      value={channelValue}
      options={CHANNEL_OPTS}
      onChange={setChannel}
      disabled={!store.canEdit || !store.project}
      ariaLabel="MIDI channel"
    />
  </Field>
  <section class="devices" aria-label="MIDI input devices">
    <span class="dlabel">MIDI devices<em class="dhint">connected inputs</em></span>
    {#if midiEmpty}
      <p class="empty">{midiEmpty}</p>
    {:else}
      <ul class="devlist">
        {#each store.midiDevices as device (device.id)}
          <li class="dev" class:off={device.state === 'disconnected'}>
            <span class="dev-name" title={device.manufacturer ? `${device.name} — ${device.manufacturer}` : device.name}>{device.name}</span>
            <StatusPill
              tone={device.state === 'connected' ? 'ok' : 'muted'}
              label={device.state === 'connected' ? 'Connected' : 'Disconnected'}
            />
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <Separator />
  <OscInputPanel {store} />

  <Separator />
  <GlobalControlsPanel {store} />

  <Separator />
  <Eyebrow>Drum zones</Eyebrow>
  <p class="zhint">
    Map each drum's zones to the MIDI notes / OSC addresses that fire them — shared by every
    trigger graph on that drum.
  </p>
  <fieldset class="drums" disabled={!store.canEdit}>
    {#each store.drums as drum (drum.id)}
      <div class="drumcard">
        <DrumZonesList {store} drumId={drum.id} drumLabel={patchLabel(store, drumZoneId(drum.id), drum.label)} />
      </div>
    {/each}
  </fieldset>
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }

  /* MIDI devices — a labelled, non-interactive list (matches Field's label styling). */
  .devices {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .dlabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .dhint {
    font-style: normal;
    color: var(--text-faint);
  }
  .devlist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .dev {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    transition-property: opacity;
    transition-duration: var(--dur-150);
  }
  .dev.off {
    opacity: 0.6;
  }
  .dev-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--text);
  }
  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
    text-wrap: pretty;
  }

  /* Drum zones — one card per drum; the fieldset is the viewer read-only gate
     (Inspector idiom) and must lay out like a plain column. */
  .zhint {
    margin: 0;
    max-width: 60ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .drums {
    border: none;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .drumcard {
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
</style>
