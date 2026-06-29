<script lang="ts">
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import { midiChannelOptions } from '../../midi/midi-note';

  let { store, open, onClose }: { store: TriggerLab; open: boolean; onClose: () => void } = $props();

  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const CHANNEL_OPTS = midiChannelOptions();

  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
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
</style>
