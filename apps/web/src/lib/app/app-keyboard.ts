/* The App-level keyboard dispatcher. The DOM adapter decides which semantic surface owns the
   event; this seam composes the browser-shortcut registry, canvas deletion, and Perform actions so
   the application has one capture-phase owner and one mounted integration seam. */

import { decideDeleteKey, isDeleteKey, type DeleteKeyNode } from './delete-key';
import { performanceKeyTarget } from './performance-key-target';
import { claimPerformanceKey, decidePerformanceKey } from './performance-key';
import { dispatchShortcut, matchesShortcut, type ShortcutEntry } from './shortcuts';
import type { voice } from '@ledrums/core';
import type { Selection, SettingsPane, View } from './shell-nav';
import type { ShortcutPlatform } from './primary-shortcut';

export interface AppKeyboardNode extends DeleteKeyNode {
  id: string;
}

export interface AppKeyboardStore {
  selectedGraph: { nodes: readonly AppKeyboardNode[] } | null;
  fireSectionGraph(index: number): void;
  stepSetlist(axis: voice.NavAxis, delta: number): boolean;
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

  // Native text editing wins before any modal/popup suppression. This keeps Backspace/Delete and
  // platform editing chords inside a dialog or popover in the browser's native path.
  if (target.isEditableTarget) return;

  // A marked control gets first refusal for the Perform keys that would otherwise be claimed by
  // the app. This check must precede modal/popup suppression: a slider/select/segmented/radio/
  // toggle may be portalled inside one of those surfaces and still needs its own arrow or digit.
  if (target.inKeyboardControl) {
    const performance = decidePerformanceKey({
      key: event.key,
      view: shell.view,
      settingsOpen: false,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isEditableTarget: false,
      inOpenPopup: false,
      inKeyboardControl: false,
      inFlowCanvas: target.inFlowCanvas,
    });
    if (performance.claim) return;
  }

  const backgroundSurface = modalOpen || target.inOpenPopup || target.inKeyboardControl;
  if (backgroundSurface) {
    const performance = decidePerformanceKey({
      key: event.key,
      view: shell.view,
      settingsOpen: false,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isEditableTarget: false,
      inOpenPopup: false,
      inKeyboardControl: false,
      inFlowCanvas: false,
    });
    // Non-editable modal/popup chrome still owns the app shortcut boundary, before later
    // SectionsView/xyflow/window listeners can act on the hidden surface. A marked control only
    // bypasses this guard for its relevant Perform key; Backspace/Delete and registered chords
    // remain suppressed there.
    if (isDeleteKey(event.key) || performance.claim || matchesShortcut(event, shortcuts, shortcutPlatform)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  // A modal or keyboard-active popup owns every app shortcut in its surface. In particular, do
  // not let a portalled menu/popover duplicate or delete the graph hidden behind it.
  if (dispatchShortcut(event, shortcuts, shortcutPlatform)) return;

  if (isDeleteKey(event.key)) {
    const selection = shell.selection;
    const node =
      selection?.kind === 'node'
        ? (store.selectedGraph?.nodes.find((candidate) => candidate.id === selection.nodeId) ?? null)
        : null;
    const { prevent, removeNode } = decideDeleteKey({
      key: event.key,
      isEditableTarget: target.isEditableTarget,
      selection,
      resolvedNode: node,
    });
    // Keep the desktop WebView from treating an unowned Backspace as history navigation. Do not
    // stop propagation here: xyflow's window listener still owns deletion of selected wires.
    if (prevent) event.preventDefault();
    if (removeNode && node) {
      store.removeNode(node);
      shell.clearSelection();
    }
    return;
  }

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
  store.stepSetlist('section', decision.sectionStep);
}
