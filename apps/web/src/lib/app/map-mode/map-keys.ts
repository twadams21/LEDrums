/* Pure keyboard decisions for MIDI-map mode (effect chains S07b). No DOM, no runes: the app
   keyboard dispatcher (`app-keyboard.ts`) feeds it a structural key event and applies the
   decision through a {@link MapKeySession}. See `.mex/patterns/keyboard-ownership.md`. */

import { MAP_MODE_COMBO, matchShortcut, parseCombo, type KeyEventLike } from '../shortcuts';
import type { ShortcutPlatform } from '../primary-shortcut';

/** What the dispatcher needs from the mounted map-mode controller. The overlay publishes it on
    the shell store (`ShellStore.setMapSession`) for as long as it is mounted. */
export interface MapKeySession {
  /** Bind the armed control to this `KeyboardEvent.code` (no-op when nothing is armed). */
  learnKey(code: string): void;
  /** Delete / Backspace: clear the armed control's binding (no-op when nothing is armed). */
  clearArmed(): void;
  /** Outside map mode: perform a key mapping. True when a mapping took the key. */
  performKey(code: string): boolean;
  /** Whether a key mapping exists for this code (held-key repeats are swallowed, not re-fired). */
  isKeyMapped(code: string): boolean;
  /** Map mode is leaving: disarm and cancel any MIDI / OSC learn. */
  reset(): void;
}

export type MapModeKeyDecision =
  /** mod+m: leave map mode. */
  | { kind: 'toggle' }
  /** Escape: leave map mode. */
  | { kind: 'exit' }
  /** Delete / Backspace: clear the armed control's binding. */
  | { kind: 'clear' }
  /** A bindable key: learn it for the armed control. */
  | { kind: 'learn'; code: string }
  /** Claimed and dropped (a held-key repeat): the rest of the app is inert while mapping. */
  | { kind: 'swallow' }
  /** Not map mode's key (a modified chord, Tab, a bare modifier): let the app pipeline run, so
      Undo and focus navigation keep working while mapping. */
  | { kind: 'pass' };

export type MapKeyEvent = KeyEventLike & { code: string; repeat: boolean };

/** Codes a key mapping can never take: focus navigation, map mode's own keys, bare modifiers. */
const UNBINDABLE_CODES = new Set([
  '',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'Fn',
  'FnLock',
  'ContextMenu',
]);

const TOGGLE = parseCombo(MAP_MODE_COMBO);

/** True for the map-mode toggle chord (mod+m) on this platform. */
export function isMapModeToggle(event: KeyEventLike, platform: ShortcutPlatform): boolean {
  return matchShortcut(event, TOGGLE, platform);
}

/** True when a plain (unmodified) key press could be a key mapping's source. Shift is excluded
    too: a mapping stores only `code`, so Shift+Q and Q would otherwise be the same binding. */
export function isBindableKey(event: MapKeyEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return !UNBINDABLE_CODES.has(event.code);
}

/** The decision for a key press while map mode is on (the caller has already yielded editable
    targets and open modals). */
export function decideMapModeKey(event: MapKeyEvent, platform: ShortcutPlatform): MapModeKeyDecision {
  if (isMapModeToggle(event, platform)) return { kind: 'toggle' };
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  if (plain && event.key === 'Escape') return { kind: 'exit' };
  if (plain && (event.key === 'Backspace' || event.key === 'Delete')) return { kind: 'clear' };
  if (!isBindableKey(event)) return { kind: 'pass' };
  if (event.repeat) return { kind: 'swallow' };
  return { kind: 'learn', code: event.code };
}
