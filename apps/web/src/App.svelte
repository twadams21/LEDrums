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
  // S08: the single app-root desktop-bridge start + the boot overlay it drives.
  import { desktopBridge } from './lib/app/desktop-bridge.svelte';
  import BootOverlay from './lib/app/chrome/BootOverlay.svelte';

  const store = new TriggerLab();
  const shell = new ShellStore(parseSearch(typeof location !== 'undefined' ? location.search : ''));

  onMount(() => {
    store.start();
    // S08: connect the desktop boot/update bridge once, here at the app root — the boot overlay and
    // ShareInfo gating both read its reactive bootStatus. Idempotent + a no-op in a plain browser.
    void desktopBridge.start();
    // Dev-only screenshot control seam (window.__LEDRUMS_SHOT__) for `pnpm ui-shot --state`.
    // Dynamic + DEV-gated so it is dead-code-eliminated from production bundles.
    if (import.meta.env.DEV) {
      void import('./lib/app/shot-seam').then((m) => m.installShotSeam(store, shell));
    }
    return () => {
      store.stop();
      desktopBridge.stop();
    };
  });

  // Performance keys (approved wave-3 shell): 1–9 fire the active section's graphs
  // 1–9 (0 → graph 10); ←/→ step through the active song's sections. Skip while
  // typing in a control; leave arrows alone inside the flow canvas (xyflow nudges
  // the selected node with them).
  function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (store.undo()) e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const selection = shell.selection;
      if (selection?.kind === 'node') {
        const node = store.selectedGraph?.nodes.find((n) => n.id === selection.nodeId);
        if (node && node.kind !== 'trigger') {
          store.removeNode(node);
          shell.clearSelection();
          e.preventDefault();
        }
      }
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const index = e.key === '0' ? 9 : Number(e.key) - 1;
      store.fireSectionGraph(index);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (el?.closest('.svelte-flow')) return; // canvas owns arrows (node nudge)
      const sections = store.activeSong?.sections ?? [];
      if (sections.length === 0) return;
      const cur = sections.findIndex((s) => s.id === store.activeSectionId);
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = sections[(cur + step + sections.length) % sections.length];
      if (next) store.setActiveSection(next.id);
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="shell-root">
  <Shell {store} {shell} />
</div>

<Overlays {store} />

<PinGate {store} />

<!-- S08: desktop boot/update takeover — renders only inside the shell, nothing in a plain browser. -->
<BootOverlay status={desktopBridge.bootStatus} active={desktopBridge.isDesktop} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
