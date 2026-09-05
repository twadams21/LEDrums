/* The App-level keyboard dispatcher. The DOM adapter decides which semantic surface owns the
   event; this seam composes the browser-shortcut registry, canvas deletion, and Perform actions so
   the application has one capture-phase owner and one mounted integration seam. */

import { decideDeleteKey, isDeleteKey, type DeleteKeyNode } from './delete-key';
import { performanceKeyTarget } from './performance-key-target';
import { claimPerformanceKey, decidePerformanceKey } from './performance-key';
import { dispatchShortcut, type ShortcutEntry } from './shortcuts';
import type { Selection, SettingsPane, View } from './shell-nav';
import type { ShortcutPlatform } from './primary-shortcut';

export interface AppKeyboardSection {
  id: string;
}

export interface AppKeyboardNode extends DeleteKeyNode {
  id: string;
}

export interface AppKeyboardStore {
  activeSong: { sections: readonly AppKeyboardSection[] } | null;
  activeSectionId: string | null;
  selectedGraph: { nodes: readonly AppKeyboardNode[] } | null;
  fireSectionGraph(index: number): void;
  setActiveSection(id: string): void;
  removeNode(node: AppKeyboardNode): void;
}

export interface AppKeyboardShell {
  view: View;
  settingsPane: SettingsPane | null;
  selection: Selection | null;
  clearSelection(): void;
}

export interface AppKeyboardDispatcherOptions {
  event: KeyboardEvent;
  store: AppKeyboardStore;
  shell: AppKeyboardShell;
  shortcuts: readonly ShortcutEntry[];
  shortcutPlatform: ShortcutPlatform;
}

export function dispatchAppKeyboard({
  event,
  store,
  shell,
  shortcuts,
  shortcutPlatform,
}: AppKeyboardDispatcherOptions): void {
  const target = performanceKeyTarget(event);
  const modalOpen = target.inModal || shell.settingsPane !== null;
  const popupOwnsKeys = target.inOpenPopup || target.inKeyboardControl;

  // A modal or keyboard-active popup owns every key in its surface. In particular, do not let a
  // portalled menu/popover duplicate or delete the graph hidden behind it.
  if (!modalOpen && !popupOwnsKeys && dispatchShortcut(event, shortcuts, shortcutPlatform)) return;

  if (isDeleteKey(event.key)) {
    const selection = shell.selection;
    const node =
      selection?.kind === 'node'
        ? (store.selectedGraph?.nodes.find((candidate) => candidate.id === selection.nodeId) ?? null)
        : null;
    const { prevent, removeNode } = decideDeleteKey({
      key: event.key,
      isEditableTarget: target.isEditableTarget || popupOwnsKeys,
      selection,
      resolvedNode: node,
    });
    // Keep the desktop WebView from treating an unowned Backspace as history navigation, but never
    // mutate the workspace while a modal or popup owns the surface.
    if (prevent) event.preventDefault();
    if (removeNode && node && !modalOpen && !popupOwnsKeys) {
      store.removeNode(node);
      shell.clearSelection();
    }
    return;
  }

  if (modalOpen || popupOwnsKeys) return;

  const decision = decidePerformanceKey({
    key: event.key,
    view: shell.view,
    settingsOpen: modalOpen,
    repeat: event.repeat,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    ...target,
  });
  claimPerformanceKey(event, decision);
  if (decision.fireGraphIndex !== undefined) {
    store.fireSectionGraph(decision.fireGraphIndex);
    return;
  }
  if (decision.sectionStep === undefined) return;

  const sections = store.activeSong?.sections ?? [];
  if (sections.length === 0) return;
  const current = sections.findIndex((section) => section.id === store.activeSectionId);
  const next = sections[(current + decision.sectionStep + sections.length) % sections.length];
  if (next) store.setActiveSection(next.id);
}
