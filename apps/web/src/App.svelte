<script lang="ts">
  /* Unified application shell. Owns the single engine store (TriggerLab — the brain
     + WS engine link) and the shell navigation store, and renders the one mode-less
     shell. The app is simply whichever view is selected (Perform being one of them);
     there is no Perform/Author mode and no crossfade. */
  import { onMount } from 'svelte';
  import { TriggerLab } from './lib/trigger-lab/store.svelte';
  import { ShellStore } from './lib/app/shell-store.svelte';
  import { parseSearch } from './lib/app/shell-nav';
  import { isEditableShortcutTarget, platformShortcutModifier } from './lib/app/primary-shortcut';
  import { decideDeleteKey, isDeleteKey } from './lib/app/delete-key';
  import { dispatchShortcut, type ShortcutEntry } from './lib/app/shortcuts';
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

  // Performance keys (approved wave-3 shell): 1–9 fire the active section's graphs
  // 1–9 (0 → graph 10); ←/→ step through the active song's sections. Skip while
  // typing in a control; leave arrows alone inside the flow canvas (xyflow nudges
  // the selected node with them).
  function onKey(e: KeyboardEvent): void {
    // With the Settings modal open, the workspace shortcuts must not act on the surface
    // BEHIND it (Backspace deleted the selected node through the modal) — including the
    // registry combos: mod+d would duplicate the hidden node, and mod+z must stay native
    // text-undo inside the modal's inputs. The Backspace preventDefault claim below still
    // applies — the WKWebView history-back hazard is the same whichever surface has focus.
    const settingsOpen = shell.settingsPane !== null;
    if (!settingsOpen && dispatchShortcut(e, shortcuts, shortcutPlatform)) return;
    const el = e.target as HTMLElement | null;
    const editable = isEditableShortcutTarget(e.target);
    if (isDeleteKey(e.key)) {
      const selection = shell.selection;
      const node =
        selection?.kind === 'node'
          ? (store.selectedGraph?.nodes.find((n) => n.id === selection.nodeId) ?? null)
          : null;
      const { prevent, removeNode } = decideDeleteKey({
        key: e.key,
        isEditableTarget: editable,
        selection,
        resolvedNode: node,
      });
      // Claim the key FIRST, whether or not anything gets deleted: an unclaimed Backspace in
      // the packaged desktop shell's bare WKWebView runs WebKit's history-back and strands the
      // drummer on the dead boot page (deleting a WIRE selects nothing, so the old node-only
      // guard fell straight through). Deliberately no stopPropagation — xyflow's key handler
      // is bubble-phase on window and still needs the event to drop the selected wire.
      if (prevent) e.preventDefault();
      if (removeNode && node && !settingsOpen) {
        store.removeNode(node);
        shell.clearSelection();
      }
      return;
    }
    if (editable || settingsOpen) return;
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
