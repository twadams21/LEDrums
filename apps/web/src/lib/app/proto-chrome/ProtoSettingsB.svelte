<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). Variant B's Settings: a substantially
     larger, sectioned modal. The Patch section does NOT embed the canvas — it
     summarises the rig and offers "Open Patch Graph", which opens the real
     canvas in a large stacked modal (ProtoPatchGraphModal). */
  import { DEFAULT_KIT } from '@ledrums/core';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import { midiChannelOptions } from '../../midi/midi-note';
  import { deviceListEmptyState } from '../chrome/midi-devices';
  import OscInputPanel from '../chrome/OscInputPanel.svelte';
  import UpdateControl from '../chrome/UpdateControl.svelte';
  import ProtoPatchGraphModal from './ProtoPatchGraphModal.svelte';
  import Cable from '@lucide/svelte/icons/cable';
  import Music from '@lucide/svelte/icons/music';
  import Wrench from '@lucide/svelte/icons/wrench';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import type { Component } from 'svelte';

  let {
    store,
    shell,
    open,
    initialPatchOpen = false,
    onClose,
  }: {
    store: TriggerLab;
    shell: ShellStore;
    open: boolean;
    /** ui-shot deep-link (`?open=patch`): land on the Patch pane with the graph modal up. */
    initialPatchOpen?: boolean;
    onClose: () => void;
  } = $props();

  type Pane = 'input' | 'patch' | 'system';
  // svelte-ignore state_referenced_locally -- deep-link seed, initial value by design
  let pane = $state<Pane>(initialPatchOpen ? 'patch' : 'input');
  // svelte-ignore state_referenced_locally -- deep-link seed, initial value by design
  let patchOpen = $state(initialPatchOpen);

  const NAV: Array<{ id: Pane; label: string; icon: Component }> = [
    { id: 'input', label: 'Input', icon: Music },
    { id: 'patch', label: 'Patch', icon: Cable },
    { id: 'system', label: 'System', icon: Wrench },
  ];

  const channelValue = $derived(store.midiChannel === null ? 'all' : String(store.midiChannel));
  const midiEmpty = $derived(
    deviceListEmptyState(store.midiAvailable, store.midiUnavailableReason, store.midiDevices.length),
  );
  const CHANNEL_OPTS = midiChannelOptions();

  function setChannel(v: string): void {
    store.setMidiChannel(v === 'all' ? null : Number(v));
  }

  // Rig summary for the Patch section header card (DEFAULT_KIT offline, like the canvas).
  const kit = $derived(store.project?.kit ?? DEFAULT_KIT);
  const drumCount = $derived(store.drums.length);
  const outputCount = $derived(kit.outputs.length);
  const hoopTotal = $derived(kit.drums.reduce((n, d) => n + (d.hoops?.length ?? d.hoopCount ?? kit.global.hoopCount), 0));
  const transport = $derived(store.project?.output ?? null);
</script>

<Dialog {open} {onClose} title="Settings" class="proto-settings">
  <header class="head">
    <h2>Settings</h2>
  </header>
  <div class="split">
    <nav class="snav" aria-label="Settings sections">
      {#each NAV as n (n.id)}
        <button type="button" class="sitem" class:on={pane === n.id} onclick={() => (pane = n.id)}>
          <n.icon size={14} aria-hidden="true" />
          {n.label}
        </button>
      {/each}
    </nav>

    <div class="pane">
      {#if pane === 'input'}
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
                <li class="dev">
                  <span class="dev-name">{device.name}</span>
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
      {:else if pane === 'patch'}
        <div class="rigcard">
          <div class="rigstats">
            <span class="stat"><b>{drumCount}</b> drums</span>
            <span class="stat"><b>{hoopTotal}</b> hoops</span>
            <span class="stat"><b>{outputCount}</b> outputs</span>
            {#if transport}
              <span class="stat"><b>{transport.protocol === 'sacn' ? 'sACN' : 'Art-Net'}</b> → {transport.host}</span>
            {/if}
          </div>
          <p class="righint">
            The patch — which controller output feeds which hoop chain — is edited on the
            Patch Graph canvas.
          </p>
          <button type="button" class="openpatch" onclick={() => (patchOpen = true)}>
            <Cable size={15} aria-hidden="true" />
            Open Patch Graph
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </div>
      {:else}
        <Field label="Updates" hint="desktop app">
          <UpdateControl />
        </Field>
      {/if}
    </div>
  </div>
</Dialog>

<ProtoPatchGraphModal {store} {shell} open={patchOpen} onClose={() => (patchOpen = false)} />

<style>
  :global(.proto-settings) {
    width: min(880px, calc(100vw - 48px));
    height: min(620px, calc(100vh - 48px));
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
  .split {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    min-height: 0;
    flex: 1;
  }
  .snav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-right: 1px solid var(--border-faint);
    background: var(--surface-2);
  }
  .sitem {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
  }
  .sitem:hover {
    color: var(--text);
    background: var(--surface-3);
  }
  .sitem.on {
    background: var(--surface-3);
    color: var(--ink);
    border-color: var(--border);
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    min-height: 0;
    overflow-y: auto;
  }
  .pane :global(.sel) {
    width: 100%;
    max-width: 280px;
  }

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
  }

  /* Patch section */
  .rigcard {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    background: var(--surface-inset);
  }
  .rigstats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .stat {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .stat b {
    font-family: var(--font-mono);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .righint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--text-faint);
    text-wrap: pretty;
  }
  .openpatch {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .openpatch:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
</style>
