<script lang="ts">
  /* The sectioned Settings modal (tabbed chrome, approved variant C): left section
     list · content pane. Open/pane state lives in the shell store (`?settings=<pane>`
     deep-links and the retired `?view=patch` URL both land here — see shell-nav).
     Each section renders its own pane component file, so the S4 slices fill their
     pane without touching this registry. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { DEFAULT_SETTINGS_PANE, type SettingsPane } from '../shell-nav';
  import LazySurface from '../../ui/LazySurface.svelte';
  import { settingsPanes } from './lazy-panes';
  import { SETTINGS_SECTIONS } from './sections';
  import Dialog from '../../ui/Dialog.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import SettingsNav from './SettingsNav.svelte';

  import X from '@lucide/svelte/icons/x';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // Keep the small Dialog/nav shell eager: focus trapping, Escape and the close
  // control must work BEFORE a pane's code arrives, without swapping dialogs.
  const open = $derived(shell.settingsPane !== null);
  /* On close the route goes null while the Dialog is still tearing down — without the
     memory, `active` would fall back to the first section and the modal would swap panes
     mid-close (remounting that pane against whatever state it needs). Hold the last open
     pane so closing never changes the visible content. */
  let lastPane = $state<SettingsPane>(DEFAULT_SETTINGS_PANE);
  $effect(() => {
    if (shell.settingsPane !== null) lastPane = shell.settingsPane;
  });
  const active = $derived(shell.settingsPane ?? lastPane);
  const paneLabel = $derived(SETTINGS_SECTIONS.find((s) => s.id === active)!.label);

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
    <SettingsNav {active} onSelect={(id) => shell.openSettings(id)} />
    <div class="pane">
      {#if open}
        {#key active}
          <LazySurface resource={settingsPanes[active]} label={paneLabel}>
            {#snippet children(Pane)}<Pane {store} />{/snippet}
          </LazySurface>
        {/key}
      {/if}
    </div>
  </div>
</Dialog>

<style>
  /* 760, not 680: the Controller pane is the tallest thing Settings has to show, and it is
     read while diagnosing a rig — the whole picture beats a scrollbar. Still clamped to the
     viewport, so a short screen degrades to scrolling rather than clipping. */
  :global(.settings-modal) {
    width: min(980px, calc(100vw - 48px));
    height: min(760px, calc(100vh - 48px));
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
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* The panes' field grids size off THIS box, not the viewport — the modal is a fixed
       width, so a viewport query would answer the wrong question. */
    container-type: inline-size;
  }
  /* Keep the panes' selects (MIDI channel etc.) form-width in the wide pane. */
  .pane :global(.sel) {
    width: 100%;
    max-width: 240px;
  }
</style>
