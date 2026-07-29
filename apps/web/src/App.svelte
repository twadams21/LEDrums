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
  import type { ShortcutEntry } from './lib/app/shortcuts';
  import Shell from './lib/app/AuthorShell.svelte';
  import Overlays from './lib/app/Overlays.svelte';
  import PinGate from './lib/app/chrome/PinGate.svelte';
  // S08: the single app-root desktop-bridge start + the boot overlay it drives.
  import { desktopBridge } from './lib/app/desktop-bridge.svelte';
  import BootOverlay from './lib/app/chrome/BootOverlay.svelte';
  // Decision 8: the blocking boot-recovery acknowledgement banner, raised off the server's `state`.
  import RecoveryBanner from './lib/app/chrome/RecoveryBanner.svelte';
  import { isAcknowledged, sessionAckStore } from './lib/app/chrome/recovery-banner';
  import { createAppKeyHandler } from './lib/app/app-keys';

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

  /** Duplicate the node selected on the Trigger canvas; a no-op (returns false, so the seam
      lets the key fall through) unless a real, selected graph node exists — this lets the
      Sections view keep its own Cmd/Ctrl+D (duplicate section) when a section is selected. */
  function duplicateSelectedNode(): boolean {
    const sel = shell.selection;
    if (sel?.kind !== 'node') return false;
    const node = store.selectedGraph?.nodes.find((n) => n.id === sel.nodeId);
    if (!node) return false;
    const clone = store.duplicateNode(node);
    if (!clone) return false;
    shell.select({ kind: 'node', nodeId: clone.id });
    return true;
  }

  // The app-level shortcut registry (data → action + description; see lib/app/shortcuts.ts).
  // Browser-default combos are CLAIMED here in capture phase. Undo lives here now rather than
  // as an inline branch below. Ctrl/Cmd+D duplicates the selected trigger-graph node.
  const shortcuts: ShortcutEntry[] = [
    { combo: 'mod+z', description: 'Undo', run: () => store.undo() },
    { combo: 'mod+d', description: 'Duplicate selected node', run: duplicateSelectedNode },
  ];

  // Whether the boot-recovery banner is up and unacknowledged: while true, the whole
  // shell keyboard AND focus tree are dead (review B1) — 1–9 fire live output, mod+z
  // mutates. `recoveryAcked` flips on the banner's ack so this recomputes.
  let recoveryAcked = $state(false);
  const recoveryBlocking = $derived(
    store.bootRecovery !== null &&
      !recoveryAcked &&
      !isAcknowledged(store.bootRecovery, sessionAckStore()),
  );

  // Performance keys (approved wave-3 shell): 1–9 fire the active section's graphs
  // 1–9 (0 → graph 10); ←/→ step through the active song's sections. Skip while
  // typing in a control; leave arrows alone inside the flow canvas (xyflow nudges
  // the selected node with them). Body lives in app-keys.ts so the blocking guard
  // is unit-tested.
  const onKey = createAppKeyHandler({
    blocked: () => recoveryBlocking,
    shortcuts,
    platform: shortcutPlatform,
    store,
    shell,
  });
</script>

<svelte:window onkeydowncapture={onKey} />

<!-- inert while the recovery banner blocks: belt+braces with the onKey guard — Tab can
     never walk behind the scrim and no pointer event reaches the shell. -->
<div class="shell-root" inert={recoveryBlocking}>
  <Shell {store} {shell} />
</div>

<Overlays {store} />

<PinGate {store} />

<!-- S08: desktop boot/update takeover — renders only inside the shell, nothing in a plain browser. -->
<BootOverlay status={desktopBridge.bootStatus} active={desktopBridge.isDesktop} />

<!-- Decision 8: blocking acknowledgement banner when the server booted through the recovery ladder.
     Mounted at the app root beside the other chrome-level takeovers so it covers every view; it
     renders nothing on a clean boot (store.bootRecovery === null). -->
<RecoveryBanner recovery={store.bootRecovery} onAck={() => (recoveryAcked = true)} />

<style>
  .shell-root {
    height: 100vh;
    width: 100vw;
  }
</style>
