<script lang="ts">
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import { midiChannelOptions } from '../../midi/midi-note';
  import { deviceListEmptyState } from './midi-devices';
  import { checkForDesktopUpdate, checkHostUpdateStatus, installDesktopUpdate } from '../desktop-updater';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const midiEmpty = $derived(
    deviceListEmptyState(store.midiAvailable, store.midiUnavailableReason, store.midiDevices.length),
  );
  const CHANNEL_OPTS = midiChannelOptions();
  let updateStatus = $state('');
  let checkingUpdate = $state(false);

  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
  }

  async function checkUpdate(): Promise<void> {
    checkingUpdate = true;
    updateStatus = 'Checking...';
    const hostStatus = await checkHostUpdateStatus();
    const desktopStatus = await checkForDesktopUpdate();
    checkingUpdate = false;

    const result = desktopStatus ?? hostStatus;
    if (!result) {
      updateStatus = 'Could not check for updates.';
      return;
    }
    if (!result.available) {
      updateStatus = result.error ? `No update status: ${result.error}` : 'No update available.';
      return;
    }
    const label = result.version ? `Version ${result.version} is available.` : 'An update is available.';
    if (!desktopStatus?.canInstall) {
      updateStatus = `${label} Install it from the desktop host.`;
      return;
    }
    const ok = window.confirm(`${label}\n\nUpdate now? Choose Cancel to install later on next launch.`);
    if (!ok) {
      updateStatus = 'Update deferred until next launch.';
      return;
    }
    updateStatus = 'Downloading update...';
    const started = await installDesktopUpdate();
    updateStatus = started ? 'Restarting to install update...' : 'Could not start update.';
  }
</script>

<Dialog {open} {onClose} title="Settings" class="settings-dialog">
  <header class="head">
    <h2>Settings</h2>
  </header>
  <div class="body">
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
    <Field label="Updates" hint="desktop app">
      <div class="update-row">
        <button type="button" class="soft" disabled={checkingUpdate} onclick={checkUpdate}>
          {checkingUpdate ? 'Checking' : 'Check for update'}
        </button>
        {#if updateStatus}<span>{updateStatus}</span>{/if}
      </div>
    </Field>
  </div>
</Dialog>

<style>
  :global(.settings-dialog) {
    width: min(360px, calc(100vw - 32px));
  }
  .head {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .body :global(.sel) {
    width: 100%;
  }
  .update-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .soft {
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .update-row span {
    color: var(--text-muted);
    font-size: var(--text-xs);
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
