/* App-level keyboard-shortcut seam.

   ONE capture-phase `keydown` listener on `window` (installed by App.svelte via
   `<svelte:window onkeydowncapture>`) consults a *data* registry of combos and, on a
   match, CLAIMS the key from the browser: `preventDefault()` + `stopPropagation()`, then
   runs the app action. Because the registry is data (combo -> action + description), a
   future "keyboard shortcuts" help sheet can render it straight from `describeShortcuts`.

   Which browser defaults we can actually claim in a normal tab:
   - Interceptable  : Ctrl/Cmd + D, S, K, O, P, the F-keys, etc. — `preventDefault` wins.
   - NOT interceptable (the browser/OS reserves them, `preventDefault` is ignored):
     Ctrl/Cmd + W (close tab), + T (new tab), + N (new window), Ctrl+Tab (tab switch).
     Do not register those; they will silently do the browser thing.

   Focus guard: a shortcut never fires while focus is in an editable surface (input /
   textarea / select / contenteditable) so ordinary typing (and native Cmd+Z inside a
   field) keeps winning — UNLESS the entry is marked `global`.

   Mac/Windows normalization lives in `primary-shortcut.ts`: `mod` in a combo means Cmd on
   macOS and Ctrl elsewhere, and the two are mutually exclusive so Ctrl+D on a Mac (a
   different, non-primary combo) does not trigger a `mod+d` entry. */

import {
  hasPrimaryModifier,
  isEditableShortcutTarget,
  type ShortcutPlatform,
} from './primary-shortcut';

/** A parsed chord. `mod` is the platform primary modifier (Cmd on mac, Ctrl elsewhere). */
export interface ShortcutCombo {
  /** Lowercased `KeyboardEvent.key` (e.g. `'d'`, `'z'`, `'k'`). */
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/** The subset of `KeyboardEvent` the matcher reads — kept structural so it unit-tests in node. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutEntry {
  /** Chord as a `+`-joined string: `'mod'`, `'shift'`, `'alt'` + a single key, e.g. `'mod+d'`. */
  combo: string;
  /** Human label for a help sheet ("Duplicate node", "Undo"). */
  description: string;
  /** Fire even while focus is in an editable surface. Default false. */
  global?: boolean;
  /** Perform the action. Return `false` when it was a no-op (nothing selected, nothing to
      undo) so the seam lets the key fall through instead of swallowing it; `true`/`undefined`
      means handled and the browser default is claimed. */
  run: () => boolean | void;
}

/** Parse a combo string (`'mod+shift+z'`) into a normalized chord. Unknown tokens besides
    `mod`/`shift`/`alt` are treated as the key; the last such token wins. */
export function parseCombo(combo: string): ShortcutCombo {
  const parsed: ShortcutCombo = { key: '', mod: false, shift: false, alt: false };
  for (const raw of combo.split('+')) {
    const token = raw.trim().toLowerCase();
    if (token === 'mod' || token === 'cmd' || token === 'ctrl' || token === 'meta') parsed.mod = true;
    else if (token === 'shift') parsed.shift = true;
    else if (token === 'alt' || token === 'option' || token === 'opt') parsed.alt = true;
    else if (token) parsed.key = token;
  }
  return parsed;
}

/** True when `event` is exactly this chord on this platform. Modifier state is matched
    exactly (extra modifiers held => no match) so distinct chords never collide. */
export function matchShortcut(
  event: KeyEventLike,
  combo: ShortcutCombo,
  platform: ShortcutPlatform,
): boolean {
  if (event.key.toLowerCase() !== combo.key) return false;
  if (event.shiftKey !== combo.shift) return false;
  if (event.altKey !== combo.alt) return false;
  if (combo.mod) return hasPrimaryModifier(event, platform);
  // No primary modifier requested: neither Ctrl nor Cmd may be held.
  return !event.ctrlKey && !event.metaKey;
}

/** Result of a dispatch: the entry that handled the event, or null (no match, a no-op run,
    or a focus-guard skip). Callers that want to know whether the key was claimed check the
    return value; the seam already called preventDefault/stopPropagation when non-null. */
export function dispatchShortcut(
  event: KeyEventLike & { target?: EventTarget | null; preventDefault(): void; stopPropagation(): void },
  registry: readonly ShortcutEntry[],
  platform: ShortcutPlatform,
): ShortcutEntry | null {
  for (const entry of registry) {
    if (!matchShortcut(event, parseCombo(entry.combo), platform)) continue;
    if (!entry.global && isEditableShortcutTarget(event.target ?? null)) return null;
    if (entry.run() === false) return null; // no-op: let the key fall through (e.g. to a view handler)
    event.preventDefault();
    event.stopPropagation();
    return entry;
  }
  return null;
}

/** Registry as render-ready data for a future shortcut help sheet. */
export function describeShortcuts(
  registry: readonly ShortcutEntry[],
): { combo: string; description: string }[] {
  return registry.map(({ combo, description }) => ({ combo, description }));
}
