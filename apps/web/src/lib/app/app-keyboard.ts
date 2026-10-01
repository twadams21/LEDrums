/* The App-level keyboard dispatcher. The DOM adapter decides which semantic surface owns the
   event; this seam composes the browser-shortcut registry, the Backspace/Delete claim, and Perform actions so
   the application has one capture-phase owner and one mounted integration seam. */

import { decideDeleteKey, isDeleteKey } from './delete-key';
import { performanceKeyTarget } from './performance-key-target';
import { claimPerformanceKey, decidePerformanceKey } from './performance-key';
import { dispatchShortcut, matchesShortcut, type ShortcutEntry } from './shortcuts';
import type { voice } from '@ledrums/core';
import type { SettingsPane, View } from './shell-nav';
import type { ShortcutPlatform } from './primary-shortcut';
import { decideMapModeKey, isBindableKey, isMapModeToggle, type MapKeySession } from './map-mode/map-keys';
import { hasPrimaryModifier } from './primary-shortcut';
import type { SelectionVerb } from '../trigger-lab/effects-api';

/**
 * The Effects view's edit keys (Tim, 2026-10-01: "highlight a plugin by clicking on it and
 * pressing delete … cut, copy and paste with the usual key commands"): Delete / Backspace, and
 * ⌘/Ctrl + X / C / V with no other modifier. Only in the Effects view (`trigger`). A copy or cut
 * while the user has page text highlighted is the browser's, so that text still copies.
 */
export function selectionVerbFor(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  view: View,
  platform: ShortcutPlatform,
  hasTextSelection: boolean,
): SelectionVerb | null {
  if (view !== 'trigger') return null;
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  if (plain && (event.key === 'Delete' || event.key === 'Backspace')) return 'delete';
  if (!hasPrimaryModifier(event, platform) || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'v') return 'paste';
  if (hasTextSelection) return null;
  return key === 'c' ? 'copy' : key === 'x' ? 'cut' : null;
}

function pageHasTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection?.();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

/** Hand an edit key to the strip; claim it when the strip took it. */
function editSelection(event: KeyboardEvent, store: AppKeyboardStore, view: View, platform: ShortcutPlatform): boolean {
  const verb = selectionVerbFor(event, view, platform, pageHasTextSelection());
  if (!verb || event.repeat || !store.editSelectionFromKeyboard?.(verb)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export interface AppKeyboardStore {
  /** Keys 1–9 / 0 audition the section's nth Effect in grid order (EffectsAuthoringApi). */
  fireEffectAt(index: number): void;
  stepSetlist(axis: voice.NavAxis, delta: number): boolean;
  /** Delete / cut / copy / paste on the Effects strip's highlighted Effect or device. True when
      the strip took the key (it had something to act on, or said why it couldn't). */
  editSelectionFromKeyboard?(verb: SelectionVerb): boolean;
}

export interface AppKeyboardShell {
  view: View;
  settingsPane: SettingsPane | null;
  /** MIDI-map mode (S07b). Optional so keyboard fixtures without map mode stay minimal. */
  mapMode?: boolean;
  setMapMode?(on: boolean): void;
  /** The mounted map-mode controller: key learn while mapping, key mappings otherwise. */
  mapSession?: MapKeySession | null;
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

  // MIDI-map mode learns first (S07b): after the editable-target check, but an open modal or
  // popup keeps its keys. Every bindable key is claimed — the app is inert while mapping, and a
  // key with nothing armed is dropped rather than firing a cell behind the overlay. Modified
  // chords pass through so Undo still works.
  if (shell.mapMode && !modalOpen && !target.inOpenPopup) {
    // Map mode's own chrome (hint bar Clear / Done, the TopBar toggle) stays keyboard-operable:
    // Enter / Space on a focused chrome control is native activation, never a key to learn.
    if (isChromeActivation(event)) return;
    const map = decideMapModeKey(event, shortcutPlatform);
    if (map.kind !== 'pass') {
      event.preventDefault();
      event.stopPropagation();
      if (map.kind === 'toggle' || map.kind === 'exit') shell.setMapMode?.(false);
      else if (map.kind === 'clear') shell.mapSession?.clearArmed();
      else if (map.kind === 'learn') shell.mapSession?.learnKey(map.code);
      return;
    }
  }

  // A marked control gets first refusal for the ARROWS the app would otherwise claim — a slider/
  // select/segmented/radio/toggle moves by them. This check must precede modal/popup suppression:
  // the control may be portalled inside one of those surfaces and still needs its arrows.
  // Digits are NOT the control's: none of these uses one, and clicking a control leaves it
  // focused, so yielding digits left the 1–9,0 audition bank dead until you clicked away
  // (Tim, 2026-09-28). A digit falls through to the audition bank below.
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
    });
    // Inside a dialog or an open list nothing fires behind it, so there the control keeps the
    // digit too, exactly as before.
    if (performance.sectionStep !== undefined || (performance.claim && (modalOpen || target.inOpenPopup))) return;
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
    });
    // A focused control on the workspace itself (no dialog, no open list over it) passes the
    // performance keys through: a mapped key performs its mapping and an audition digit fires
    // its Effect, and neither reaches the control. The keys the control NAVIGATES by stay its own,
    // and Delete and the registered chords stay suppressed below — Backspace on a focused slider
    // must not act on what it edits. Same order as the unfocused path: mappings first.
    if (target.inKeyboardControl && !modalOpen && !target.inOpenPopup) {
      // The card a focused control sits on is the highlighted one (a press selects it), so its
      // Delete / ⌘X / ⌘C / ⌘V act on that card — a slider has no use for them.
      if (editSelection(event, store, shell.view, shortcutPlatform)) return;
      const session = shell.mapSession;
      if (session && isBindableKey(event) && !CONTROL_NAVIGATION_CODES.has(event.code)) {
        const took = event.repeat ? session.isKeyMapped(event.code) : session.performKey(event.code);
        if (took) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (performance.fireEffectIndex !== undefined) {
        claimPerformanceKey(event, performance);
        store.fireEffectAt(performance.fireEffectIndex);
        return;
      }
    }
    // Non-editable modal/popup chrome still owns the app shortcut boundary, before later
    // SectionsView/window listeners can act on the hidden surface. A marked control only
    // bypasses this guard for its relevant Perform key; Backspace/Delete and registered chords
    // remain suppressed there.
    if (isDeleteKey(event.key) || performance.claim || matchesShortcut(event, shortcuts, shortcutPlatform)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  // A modal or keyboard-active popup owns every app shortcut in its surface. In particular, do
  // not let a portalled menu/popover duplicate or delete what is hidden behind it.
  if (dispatchShortcut(event, shortcuts, shortcutPlatform)) return;

  if (editSelection(event, store, shell.view, shortcutPlatform)) return;

  if (shell.setMapMode && isMapModeToggle(event, shortcutPlatform)) {
    event.preventDefault();
    event.stopPropagation();
    shell.setMapMode(!shell.mapMode);
    return;
  }

  // Key mappings (S07b) fire outside map mode. Editable targets, modals, popups and keyboard-
  // owning controls already returned above, so a mapped key never steals a field's typing or a
  // slider's arrows. A held key fires once: its repeats are swallowed, not re-performed.
  const session = shell.mapSession;
  if (session && isBindableKey(event)) {
    const took = event.repeat ? session.isKeyMapped(event.code) : session.performKey(event.code);
    if (took) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  if (isDeleteKey(event.key)) {
    const { prevent } = decideDeleteKey({ key: event.key, isEditableTarget: target.isEditableTarget });
    // Keep the desktop WebView from treating an unowned Backspace as history navigation. Do not
    // stop propagation here: a later listener in the event's path may still own the key.
    if (prevent) event.preventDefault();
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
  if (decision.fireEffectIndex !== undefined) {
    store.fireEffectAt(decision.fireEffectIndex);
    return;
  }
  if (decision.sectionStep === undefined) return;
  store.stepSetlist('section', decision.sectionStep);
}

const ACTIVATION_CODES = new Set(['Enter', 'NumpadEnter', 'Space']);

/** The keys a focused slider / segmented / radio / toggle / closed select moves or activates by.
    A mapping on one of these stays inert while such a control has focus; every other mapped key,
    and every audition digit, passes the control (Tim, 2026-09-28). */
const CONTROL_NAVIGATION_CODES = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'Enter', 'NumpadEnter',
]);

/** Enter / Space whose target is map-mode chrome (`[data-map-mode-chrome]`): the browser's
    native button activation, which map mode's key learn must not claim. */
function isChromeActivation(event: KeyboardEvent): boolean {
  if (!ACTIVATION_CODES.has(event.code)) return false;
  return event.target instanceof Element && event.target.closest('[data-map-mode-chrome]') !== null;
}
