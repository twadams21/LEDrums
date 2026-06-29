<script lang="ts">
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import { midiChannelOptions } from '../../midi/midi-note';
  import { checkForDesktopUpdate, installDesktopUpdate } from '../desktop-updater';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const CHANNEL_OPTS = midiChannelOptions();
  let updateStatus = $state('');
  let checkingUpdate = $state(false);

  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
  }

  async function checkUpdate(): Promise<void> {
    checkingUpdate = true;
    updateStatus = 'Checking...';
    const result = await checkForDesktopUpdate();
    checkingUpdate = false;
    if (!result) {
      updateStatus = 'Updater is only available in the desktop app.';
      return;
    }
    if (!result.available) {
      updateStatus = 'No update available.';
      return;
    }
    const label = result.version ? `Version ${result.version} is available.` : 'An update is available.';
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
</style>
