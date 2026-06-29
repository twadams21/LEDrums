<script lang="ts">
  /* Unified application shell. Owns the single engine store (TriggerLab — the brain
     + WS engine link) and the shell navigation store, and renders the one mode-less
     shell. The app is simply whichever view is selected (Perform being one of them);
     there is no Perform/Author mode and no crossfade. */
  import { onMount } from 'svelte';
  import { TriggerLab } from './lib/trigger-lab/store.svelte';
  import { ShellStore } from './lib/app/shell-store.svelte';
  import { parseSearch } from './lib/app/shell-nav';
  import Shell from './lib/app/AuthorShell.svelte';
  import Overlays from './lib/app/Overlays.svelte';
  import PinGate from './lib/app/chrome/PinGate.svelte';

  const store = new TriggerLab();
  const shell = new ShellStore(parseSearch(typeof location !== 'undefined' ? location.search : ''));

  onMount(() => {
    store.start();
    return () => store.stop();
  });

  // Number keys play the active section's graph list: 1–9 → graphs 1–9, 0 → graph 10.
  // Extra keys (beyond the section's graph count) do nothing. Skip while typing in a control.
  function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const index = e.key === '0' ? 9 : Number(e.key) - 1;
    store.fireSectionGraph(index);
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="shell-root">
  <Shell {store} {shell} />
</div>

<Overlays {store} />

<PinGate {store} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
