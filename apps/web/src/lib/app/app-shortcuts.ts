/* The App-level shortcut registry (data → action + description; see ./shortcuts.ts), built
   here rather than inline in App.svelte so AppKeyboardCapture tests exercise the REAL entries.

   Registered combos double as the modal boundary: while a modal / popup owns the keyboard,
   AppKeyboardCapture consumes (preventDefault + stopPropagation) any combo matched here, so a
   later SectionsView/window listener cannot act on the hidden surface. */
import type { ShortcutEntry } from './shortcuts';

export interface AppShortcutStore {
  undo(): boolean;
}

export function createAppShortcuts(store: AppShortcutStore): ShortcutEntry[] {
  return [
    { combo: 'mod+z', description: 'Undo', run: () => store.undo() },
    // SectionsView owns section duplicate (its own window capture listener, which bails on
    // `defaultPrevented`). This entry is a deliberate no-op so the chord stays registered:
    // outside a modal it falls through to that view; inside a modal it is consumed, so Cmd+D
    // can't duplicate the section selected behind the dialog.
    { combo: 'mod+d', description: 'Duplicate selected section', run: () => false },
  ];
}
