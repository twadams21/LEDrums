<script lang="ts">
  /* Unified application shell. Owns the single engine store (TriggerLab — the brain
     + WS engine link) and the shell navigation store, and renders the one mode-less
     shell. The app is simply whichever view is selected (Perform being one of them);
     there is no Perform/Author mode and no crossfade. */
  import { onMount } from 'svelte';
  import { TriggerLab } from './lib/trigger-lab/store.svelte';
  import { ShellStore } from './lib/app/shell-store.svelte';
  import { parseSearch } from './lib/app/shell-nav';
  import type { Pad } from './lib/trigger-lab/fixtures';
  import Shell from './lib/app/AuthorShell.svelte';
  import Overlays from './lib/app/Overlays.svelte';

  const store = new TriggerLab();
  const shell = new ShellStore(parseSearch(typeof location !== 'undefined' ? location.search : ''));

  onMount(() => {
    store.start();
    return () => store.stop();
  });

  // number keys 1–9 fire the corresponding pad (skip while typing in a control)
  const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;
  function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= store.pads.length) {
      const pad = store.pads[n - 1]!;
      store.selectedPadKey = padKey(pad);
      store.hit(pad);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="shell-root">
  <Shell {store} {shell} />
</div>

<Overlays {store} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
