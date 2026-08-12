<script lang="ts">
  /* Settings › General — today's app-wide settings, moved intact from the retired
     chrome/AppSettingsDialog: desktop updates, MIDI input channel + device list,
     OSC input, and the global control bindings. The S4 slices re-home input and
     updates into their own panes; until then this section keeps settings parity
     in one place. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import { midiChannelOptions } from '../../../midi/midi-note';
  import { deviceListEmptyState } from '../../chrome/midi-devices';
  import GlobalControlsPanel from '../../chrome/GlobalControlsPanel.svelte';
  import OscInputPanel from '../../chrome/OscInputPanel.svelte';
  import UpdateControl from '../../chrome/UpdateControl.svelte';

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
  <h3>General</h3>
  <!-- Updates first: an update prompt is the one thing here that should never
       need scrolling to. -->
  <Field label="Updates" hint="desktop app">
    <UpdateControl />
  </Field>
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
  <OscInputPanel {store} />
  <GlobalControlsPanel {store} />
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
</style>
