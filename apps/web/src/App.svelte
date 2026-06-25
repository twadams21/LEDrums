<script lang="ts">
  /* Unified application shell. Owns the single engine store (TriggerLab — the
     brain + WS engine link) and the shell navigation store, and crossfades
     between the Perform and Author surfaces off shell.mode. Both surfaces render
     over the SAME engine store, so switching mode never restarts the engine. */
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import { TriggerLab } from './lib/trigger-lab/store.svelte';
  import { ShellStore } from './lib/app/shell-store.svelte';
  import { parseSearch } from './lib/app/shell-nav';
  import type { Pad } from './lib/trigger-lab/fixtures';
  import AuthorShell from './lib/app/AuthorShell.svelte';
  import PerformShell from './lib/app/PerformShell.svelte';
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

  // mode transition — a fast fade+lift, instant under reduced-motion.
  function shellReveal(_node: Element, { duration = 200 } = {}): TransitionConfig {
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reduce ? 0 : duration,
      easing: cubicOut,
      css: (t: number) => `opacity:${t}; transform: scale(${0.994 + t * 0.006});`,
    };
  }
</script>

<svelte:window onkeydown={onKey} />

{#key shell.mode}
  <div class="shell-root" in:shellReveal>
    {#if shell.mode === 'perform'}
      <PerformShell {store} {shell} />
    {:else}
      <AuthorShell {store} {shell} />
    {/if}
  </div>
{/key}

<Overlays {store} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
