<script lang="ts">
  /* Unified application shell. Owns the single engine store (TriggerLab — the brain
     + WS engine link) and the shell navigation store, and renders the one mode-less
     shell. The app is simply whichever view is selected (Perform being one of them);
     there is no Perform/Author mode and no crossfade. */
  import { onMount } from 'svelte';
  import { TriggerLab } from './lib/trigger-lab/store.svelte';
  import { ShellStore } from './lib/app/shell-store.svelte';
  import { parseSearch } from './lib/app/shell-nav';
  import { platformShortcutModifier } from './lib/app/primary-shortcut';
  import { createAppShortcuts } from './lib/app/app-shortcuts';
  import AppKeyboardCapture from './lib/app/AppKeyboardCapture.svelte';
  import Shell from './lib/app/AuthorShell.svelte';
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

  const shortcutPlatform = platformShortcutModifier(
    typeof navigator !== 'undefined' ? navigator.platform : '',
  );

  // The app-level shortcut registry (see lib/app/app-shortcuts.ts). Browser-default combos are
  // CLAIMED in capture phase; registered combos are also consumed inside modals.
  const shortcuts = createAppShortcuts(store);

</script>

<div class="shell-root">
  <Shell {store} {shell} />
</div>

<AppKeyboardCapture {store} {shell} {shortcuts} {shortcutPlatform} />

<PinGate {store} />

<!-- S08: desktop boot/update takeover — renders only inside the shell, nothing in a plain browser. -->
<BootOverlay status={desktopBridge.bootStatus} active={desktopBridge.isDesktop} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
