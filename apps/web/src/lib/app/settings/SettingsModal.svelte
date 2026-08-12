<script lang="ts">
  /* The sectioned Settings modal (tabbed chrome, approved variant C): left section
     list · content pane. Open/pane state lives in the shell store (`?settings=<pane>`
     deep-links and the retired `?view=patch` URL both land here — see shell-nav).
     Each section renders its own pane component file, so the S4 slices fill their
     pane without touching this registry. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { DEFAULT_SETTINGS_PANE, type SettingsPane } from '../shell-nav';
  import type { Component } from 'svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import InputPane from './panes/InputPane.svelte';
  import DrumsHoopsPane from './panes/DrumsHoopsPane.svelte';
  import OutputsChainsPane from './panes/OutputsChainsPane.svelte';
  import ControllerPane from './panes/ControllerPane.svelte';
  import SystemPane from './panes/SystemPane.svelte';
  import Music from '@lucide/svelte/icons/music';
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import Cable from '@lucide/svelte/icons/cable';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Wrench from '@lucide/svelte/icons/wrench';
  import X from '@lucide/svelte/icons/x';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  /** The section registry — order matches SETTINGS_PANES (shell-nav). Every pane
      receives `{ store }`; the S2 stubs simply ignore it until their slice lands. */
  const SECTIONS: Array<{ id: SettingsPane; label: string; icon: Component; pane: Component<{ store: TriggerLab }> }> = [
    { id: 'input', label: 'Input', icon: Music, pane: InputPane },
    { id: 'drums', label: 'Drums & Hoops', icon: CircleDot, pane: DrumsHoopsPane },
    { id: 'outputs', label: 'Outputs & Chains', icon: Cable, pane: OutputsChainsPane },
    { id: 'controller', label: 'Controller', icon: Cpu, pane: ControllerPane },
    { id: 'system', label: 'System', icon: Wrench, pane: SystemPane },
  ];

  const open = $derived(shell.settingsPane !== null);
  /* On close the route goes null while the Dialog is still tearing down — without the
     memory, `active` would fall back to the first section and the modal would swap panes
     mid-close (remounting that pane against whatever state it needs). Hold the last open
     pane so closing never changes the visible content. */
  let lastPane = $state<SettingsPane>(DEFAULT_SETTINGS_PANE);
  $effect(() => {
    if (shell.settingsPane !== null) lastPane = shell.settingsPane;
  });
  const active = $derived(SECTIONS.find((s) => s.id === (shell.settingsPane ?? lastPane)) ?? SECTIONS[0]!);

  /** Every close path (X, Esc, backdrop) disarms any pending MIDI/OSC learn — an arm
      left live after the modal closes is invisible, and the next stray input would
      silently bind it. Both cancels are no-ops when nothing is armed. */
  function close(): void {
    store.cancelMidiLearn();
    store.cancelOscLearn();
    shell.closeSettings();
  }
</script>

<Dialog {open} onClose={close} title="Settings" class="settings-modal">
  <header class="head">
    <h2>Settings</h2>
    <IconButton icon={X} label="Close settings" size={15} onclick={close} />
  </header>
  <div class="split">
    <nav class="snav" aria-label="Settings sections">
      {#each SECTIONS as s (s.id)}
        <button type="button" class="sitem" class:on={active.id === s.id} onclick={() => shell.openSettings(s.id)}>
          <s.icon size={14} aria-hidden="true" />
          {s.label}
        </button>
      {/each}
    </nav>
    <div class="pane">
      <active.pane {store} />
    </div>
  </div>
</Dialog>

<style>
  :global(.settings-modal) {
    width: min(980px, calc(100vw - 48px));
    height: min(680px, calc(100vh - 48px));
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
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
    grid-template-columns: 200px minmax(0, 1fr);
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
    overscroll-behavior: contain;
  }
  /* Keep the panes' selects (MIDI channel etc.) form-width in the wide pane. */
  .pane :global(.sel) {
    width: 100%;
    max-width: 240px;
  }
</style>
