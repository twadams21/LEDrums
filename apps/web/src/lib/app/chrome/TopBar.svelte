<script lang="ts">
  /* Nav bar (tabbed chrome row 1): brand · view tabs · show identity + status.
     The identity chip is the document control — the active show's name edited in
     place (→ store.renameShow), the save state, and the ListMusic project menu
     (ShowBrowser: New / Open / Save / Save-As / Rename / Delete). To its right:
     Share, presence/takeover, Backups, UpdateBadge, and the Settings gear (the
     Settings modal is shell-routed — `?settings=<pane>` deep-links open it too).
     Engine stats (StatusBar · OutputPill) live in the bottom bar. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import ViewTabs from './ViewTabs.svelte';
  import ShareInfo from './ShareInfo.svelte';
  import ShowBrowser from './ShowBrowser.svelte';
  import BackupsDialog from './BackupsDialog.svelte';
  import SaveIndicator from './SaveIndicator.svelte';
  import UpdateBadge from './UpdateBadge.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import Logo from '../../ui/Logo.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';
  import History from '@lucide/svelte/icons/history';
  import Settings from '@lucide/svelte/icons/settings';
  import KeyboardMusic from '@lucide/svelte/icons/keyboard-music';
  import Tooltip from '../../ui/Tooltip.svelte';
  import { MAP_MODE_COMBO } from '../shortcuts';
  import { platformShortcutModifier } from '../primary-shortcut';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const showName = $derived(store.activeShow?.name ?? 'Untitled show');

  let browserOpen = $state(false);
  let backupsOpen = $state(false);
  let editingName = $state(false);

  // "⌘M" on macOS, "Ctrl+M" elsewhere — read off the one combo the dispatcher matches.
  const mapChord = (() => {
    const key = MAP_MODE_COMBO.split('+').at(-1)!.toUpperCase();
    const mac = platformShortcutModifier(typeof navigator !== 'undefined' ? navigator.platform : '') === 'mac';
    return mac ? `⌘${key}` : `Ctrl+${key}`;
  })();

  function commitName(name: string): void {
    editingName = false;
    store.renameShow(store.activeShowId, name);
  }
</script>

<header class="topbar">
  <div class="brand">
    <Logo size={24} />
    <span class="word">LEDrums</span>
  </div>

  <ViewTabs {shell} />

  <div class="right">
    <div class="identity">
      <IconButton icon={ListMusic} label="Shows" size={15} onclick={() => (browserOpen = true)} />
      {#if editingName}
        <span class="name-edit">
          <CommitInput value={showName} ariaLabel="Show name" onCommit={commitName} onCancel={() => (editingName = false)} />
        </span>
      {:else}
        <button
          type="button"
          class="name"
          title={store.canEdit ? 'Rename show' : 'Viewing — another client is editing'}
          disabled={!store.canEdit}
          onclick={() => store.canEdit && (editingName = true)}
        >
          {showName}
        </button>
      {/if}
      <SaveIndicator {store} />
    </div>
    <ShareInfo {store} />
    {#if store.canTakeover}
      <!-- Viewer (another client edits): clear read-only indicator + a one-press Takeover. -->
      <div class="presence presence--viewing">
        <span class="presence-dot" aria-hidden="true"></span>
        <span class="presence-label">{store.editorLabel} — <strong>Viewing</strong></span>
        <button type="button" class="takeover" onclick={() => store.takeover()} title="Become the editor">
          Take over
        </button>
      </div>
    {:else if store.role === 'editor'}
      <!-- Editor with other clients connected: confirm we hold the authoring slot. -->
      <div class="presence presence--editing">
        <span class="presence-dot" aria-hidden="true"></span>
        <span class="presence-label">You're editing</span>
      </div>
    {/if}
    <!-- MIDI-map mode toggle. It stays live and undimmed while mapping (data-map-mode-chrome):
         the capture layer lets it through, so it is how you leave the mode as well. -->
    <Tooltip text={shell.mapMode ? `Leave MIDI map mode (${mapChord} / Esc)` : `MIDI map mode (${mapChord})`} side="bottom">
      <button
        type="button"
        class="map-toggle"
        class:on={shell.mapMode}
        aria-pressed={shell.mapMode}
        data-map-mode-chrome
        onclick={() => shell.toggleMapMode()}
      >
        <KeyboardMusic size={15} aria-hidden="true" />
        <span>MIDI</span>
      </button>
    </Tooltip>
    <IconButton icon={History} label="Backups" size={15} onclick={() => (backupsOpen = true)} />
    <!-- The update flow lives in Settings › System — land the badge there, not the default pane. -->
    <UpdateBadge onOpen={() => shell.openSettings('system')} />
    <IconButton icon={Settings} label="Settings" size={15} onclick={() => shell.openSettings()} />
  </div>
</header>

<ShowBrowser {store} open={browserOpen} onClose={() => (browserOpen = false)} />
<BackupsDialog {store} open={backupsOpen} onClose={() => (backupsOpen = false)} />
<SettingsModal {store} {shell} />

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 100%;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .word {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .right {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
    min-width: 0;
  }

  /* The show-identity chip: project menu · in-place-editable name · save state.
     A fixed footprint so a longer/shorter name never reflows the controls to its
     right — the name truncates within (.name max-width via flex/min-width). */
  .identity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    flex: 0 1 240px;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 2px 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-1);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: var(--border);
  }
  .name:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .name-edit {
    display: block;
    flex: 1;
    min-width: 120px;
  }

  /* MIDI-map toggle: a labelled icon button, --map orange while the mode is on. */
  .map-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    height: var(--control-icon-size);
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    cursor: pointer;
    transition:
      background-color var(--dur-120) ease,
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .map-toggle:hover {
    background: var(--surface-inset);
    color: var(--ink);
  }
  .map-toggle:active {
    scale: 0.96;
  }
  .map-toggle:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 1px;
  }
  .map-toggle.on {
    background: var(--map);
    border-color: var(--map-bright);
    color: var(--on-map);
  }
  .map-toggle.on:hover {
    background: var(--map-bright);
    color: var(--on-map);
  }

  /* Multi-client editing indicator: who holds the single authoring slot. */
  .presence {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .presence-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
  .presence--editing .presence-dot {
    background: var(--role-content, #4caf50);
  }
  .presence--viewing .presence-dot {
    background: var(--text-faint);
  }
  .presence-label strong {
    color: var(--ink);
    font-weight: 600;
  }
  .takeover {
    margin-left: var(--space-1);
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--surface-3);
    color: var(--ink);
    font-size: var(--text-2xs);
    font-weight: 600;
    cursor: pointer;
  }
  .takeover:hover {
    background: var(--accent, var(--surface-3));
    border-color: var(--accent, var(--border));
  }
</style>
