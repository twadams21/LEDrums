<script lang="ts">
  /* Top bar: brand · show identity · transport · engine status · output pill.
     The show control is the document identity: the active show's name shown + edited
     in place (→ store.renameShow), with a ListMusic affordance that opens the show
     browser (New / Open / Save / Save-As / Close / Rename / Delete). The live section
     context rides underneath so the bar still reads at a glance. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import Transport from './Transport.svelte';
  import OutputPill from './OutputPill.svelte';
  import StatusBar from '../../trigger-lab/StatusBar.svelte';
  import ShowBrowser from './ShowBrowser.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';

  // `shell` stays in the props type (the shell passes it) but is unused — the ModeSwitch
  // that consumed it is gone, and the show title reads straight from the store.
  let { store }: { store: TriggerLab; shell: ShellStore } = $props();

  const activeName = $derived(store.activeSection?.name ?? '—');
  const showName = $derived(store.activeShow?.name ?? 'Untitled show');

  let browserOpen = $state(false);
  let editingName = $state(false);

  function commitName(name: string): void {
    editingName = false;
    store.renameShow(store.activeShowId, name);
  }
</script>

<header class="topbar">
  <div class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">LEDrums</span>
  </div>

  <div class="setlist">
    <IconButton icon={ListMusic} label="Shows" size={15} onclick={() => (browserOpen = true)} />
    <span class="set-labels">
      {#if editingName}
        <span class="set-name-edit">
          <CommitInput value={showName} ariaLabel="Show name" onCommit={commitName} onCancel={() => (editingName = false)} />
        </span>
      {:else}
        <button type="button" class="set-name" title="Rename show" onclick={() => (editingName = true)}>
          {showName}
        </button>
      {/if}
      <span class="set-sub">{store.sections.length} sections · {activeName}</span>
    </span>
  </div>

  <div class="transport-slot"><Transport {store} /></div>

  <div class="right">
    <StatusBar {store} />
    <OutputPill {store} />
  </div>
</header>

<ShowBrowser {store} open={browserOpen} onClose={() => (browserOpen = false)} />

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
  .mark {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-2);
    background: conic-gradient(
      from 210deg,
      var(--role-input),
      var(--role-content),
      var(--role-effect),
      var(--role-layer),
      var(--role-output),
      var(--role-input)
    );
    flex: none;
  }
  .word {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .setlist {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--text-faint);
    flex: none;
  }
  .set-labels {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  /* the show name is an in-place editable title: a bare button that reveals a CommitInput */
  .set-name {
    align-self: flex-start;
    max-width: 22ch;
    margin: -2px -4px;
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
  .set-name:hover {
    background: var(--surface-3);
    border-color: var(--border);
  }
  .set-name-edit {
    display: block;
    width: 180px;
  }
  .set-sub {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .transport-slot {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }
  .right {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
  }
</style>
