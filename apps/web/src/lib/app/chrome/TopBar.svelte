<script lang="ts">
  /* Top bar: brand · setlist context · transport · engine status · output pill.
     The setlist control is a readout for now (open/save/new
     needs a project-persistence seam the engine store doesn't have yet — a later
     milestone); it shows the live section context so the bar isn't hollow. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import Transport from './Transport.svelte';
  import OutputPill from './OutputPill.svelte';
  import StatusBar from '../../trigger-lab/StatusBar.svelte';
  import ListMusic from '@lucide/svelte/icons/list-music';

  // `shell` stays in the props type (the shell passes it) but is unused for now —
  // the ModeSwitch that consumed it is gone; a later slice adds the show-title here.
  let { store }: { store: TriggerLab; shell: ShellStore } = $props();

  const activeName = $derived(store.activeSection?.name ?? '—');
</script>

<header class="topbar">
  <div class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">LEDrums</span>
  </div>

  <div class="setlist" title="Setlist (open / save / new — coming in a later slice)">
    <ListMusic size={15} aria-hidden="true" />
    <span class="set-labels">
      <span class="set-name">Untitled show</span>
      <span class="set-sub">{store.sections.length} sections · {activeName}</span>
    </span>
  </div>

  <div class="transport-slot"><Transport {store} /></div>

  <div class="right">
    <StatusBar {store} />
    <OutputPill {store} />
  </div>
</header>

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
  .set-name {
    font-size: var(--text-sm);
    color: var(--ink);
    font-weight: 600;
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
