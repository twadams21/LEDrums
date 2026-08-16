<script lang="ts">
  /* Settings › Input (S4a §2.1) — the two ways sound gets in: MIDI (channel filter +
     connected-device list, from General) and OSC (`OscInputPanel` reused wholesale, which
     owns its listen status, fault callout and learn affordances).

     The per-drum zone wiring and the global control bindings that used to stack below
     these are their own sections now (Drum trigger zones · Global controls) — same
     components, same mutation paths, one scroll each instead of one four-deep column. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import Separator from '../../../ui/Separator.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import ListHead from '../../../ui/ListHead.svelte';
  import TypeChip from '../../../ui/TypeChip.svelte';
  import { midiChannelOptions } from '../../../midi/midi-note';
  import { deviceListEmptyState } from '../../chrome/midi-devices';
  import OscInputPanel from '../../chrome/OscInputPanel.svelte';
  import PaneHeader from '../PaneHeader.svelte';

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
  <PaneHeader id="input" />

  <Eyebrow>MIDI input</Eyebrow>
  <Field label="MIDI channel" info="Only accept MIDI on this channel.">
    <Select
      value={channelValue}
      options={CHANNEL_OPTS}
      onChange={setChannel}
      disabled={!store.canEdit || !store.project}
      ariaLabel="MIDI channel"
    />
  </Field>
  <section class="devices" aria-label="MIDI input devices">
    <ListHead label="MIDI devices" count={store.midiDevices.length} />
    {#if midiEmpty}
      <p class="empty">{midiEmpty}</p>
    {:else}
      <ul class="devlist">
        {#each store.midiDevices as device (device.id)}
          <li class="dev" class:off={device.state === 'disconnected'}>
            <TypeChip label="midi in" tint="var(--role-input)" />
            <span class="dev-name" title={device.manufacturer ? `${device.name} — ${device.manufacturer}` : device.name}>{device.name}</span>
            {#if device.manufacturer}<span class="dev-make">{device.manufacturer}</span>{/if}
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
</div>

<style>
  .pane-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  /* MIDI devices — a labelled, non-interactive list (matches Field's label styling). */
  .devices {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .dev-make {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    gap: var(--space-2);
    min-height: 34px;
    padding: var(--space-1) var(--space-2);
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
    flex: 1;
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
