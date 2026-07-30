/* The app-shell window keydown handler, extracted from App.svelte so its blocking
   guard is unit-testable (review B1): while an unacked boot-recovery banner is up,
   NOTHING may fire — 1–9/0 drive live output, Delete/Backspace mutate the graph,
   mod+z undoes, arrows change the live section. The banner covers the pointer via
   its scrim and the shell is additionally `inert`, but this capture-phase window
   listener sits above both, so it must gate itself. */
import { dispatchShortcut, type ShortcutEntry } from './shortcuts';
import type { ShortcutPlatform } from './primary-shortcut';

interface GraphNodeLike {
  id: string;
  kind: string;
}

/** The store surface the shell keys drive (structural, so tests use fakes). */
export interface AppKeyStore {
  selectedGraph: { nodes: GraphNodeLike[] } | null | undefined;
  removeNode(node: GraphNodeLike): void;
  fireSectionGraph(index: number): void;
  activeSong: { sections: readonly { id: string }[] } | null | undefined;
  arrangement: { activeSectionId: string | null | undefined };
  setActiveSection(id: string): void;
}

export interface AppKeyShell {
  selection: { kind: string; nodeId?: string } | null | undefined;
  clearSelection(): void;
}

export interface AppKeyDeps {
  /** True while a blocking chrome takeover (unacked recovery banner) is up — every key is inert. */
  blocked(): boolean;
  shortcuts: readonly ShortcutEntry[];
  platform: ShortcutPlatform;
  store: AppKeyStore;
  shell: AppKeyShell;
}

type AppKeyEvent = KeyboardEvent | (Parameters<typeof dispatchShortcut>[0] & { target: EventTarget | null });

export function createAppKeyHandler(deps: AppKeyDeps): (e: AppKeyEvent) => void {
  const { shortcuts, platform, store, shell } = deps;
  return (e) => {
    // Blocking banner up → the shell keyboard is dead. Checked BEFORE the shortcut
    // registry so even mod+z cannot mutate behind the scrim.
    if (deps.blocked()) return;
    if (dispatchShortcut(e, shortcuts, platform)) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
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
      const cur = sections.findIndex((s) => s.id === store.arrangement.activeSectionId);
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = sections[(cur + step + sections.length) % sections.length];
      if (next) store.setActiveSection(next.id);
    }
  };
}
