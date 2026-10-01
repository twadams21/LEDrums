/* Shell navigation model — the unified app's view-router + inspector selection,
   as a PURE reducer (no runes, no DOM) so the invariants are unit-testable in
   the node test env. `shell-store.svelte.ts` is a thin rune wrapper over this.
   Mirrors the show-builder split: pure core, reactive shell.

   The app is mode-less: there is no Perform/Author mode — it is simply whichever
   `view` is selected (Perform being one of them). The invariant lives here once
   (locality): switching views clears the selection. Selections open in place —
   bus in the Buses panel, section in the Sections view — so there is no global
   dock tab to route. */

export type View = 'perform' | 'objects' | 'sections' | 'trigger' | 'monitor';

/** Settings-modal section ids (tabbed chrome: the patch surface lives in Settings).
    No 'general' catch-all — every setting has a specific pane home (S4). */
export type SettingsPane = 'input' | 'zones' | 'controls' | 'drums' | 'outputs' | 'controller' | 'system';

export const SETTINGS_PANES: readonly SettingsPane[] = [
  'input',
  'zones',
  'controls',
  'drums',
  'outputs',
  'controller',
  'system',
];

export const DEFAULT_SETTINGS_PANE: SettingsPane = 'input';

/** What is loaded into an inspector surface: a layer/bus, or a setlist section (rename +
    read-only transport-recall info). `null` = nothing selected. */
export type Selection =
  | { kind: 'bus'; busId: string }
  | { kind: 'section'; sectionId: string };

export interface ShellNav {
  view: View;
  selection: Selection | null;
  /** The open Settings-modal section, or null when the modal is closed. */
  settings: SettingsPane | null;
  /** MIDI-map mode (effect chains S07b): while on, clicks arm mappable controls for learn
      instead of acting. Orthogonal to the view — mapping spans every view — so view switches
      leave it alone. */
  mapMode: boolean;
}

export const VIEWS: readonly View[] = ['perform', 'objects', 'sections', 'trigger', 'monitor'];

export function initialNav(init: Partial<Pick<ShellNav, 'view' | 'settings'>> = {}): ShellNav {
  return {
    view: init.view ?? 'trigger',
    selection: null,
    settings: init.settings ?? null,
    mapMode: false,
  };
}

/** Enter / leave MIDI-map mode. No-op when already in that state. */
export function setMapMode(nav: ShellNav, on: boolean): ShellNav {
  if (nav.mapMode === on) return nav;
  return { ...nav, mapMode: on };
}

/** Switch the workspace view; resets the Inspector selection (wireframe:
    "switching views resets the Inspector"). No-op when already on the view. */
export function setView(nav: ShellNav, view: View): ShellNav {
  if (view === nav.view) return nav;
  return { ...nav, view, selection: null };
}

/** Load something into its inspector surface. */
export function select(nav: ShellNav, selection: Selection): ShellNav {
  return { ...nav, selection };
}

export function clearSelection(nav: ShellNav): ShellNav {
  if (nav.selection === null) return nav;
  return { ...nav, selection: null };
}

/** Open the Settings modal on `pane` (default section when unspecified). The
    workspace view + selection are untouched — the modal overlays them. */
export function openSettings(nav: ShellNav, pane: SettingsPane = DEFAULT_SETTINGS_PANE): ShellNav {
  if (nav.settings === pane) return nav;
  return { ...nav, settings: pane };
}

export function closeSettings(nav: ShellNav): ShellNav {
  if (nav.settings === null) return nav;
  return { ...nav, settings: null };
}

/** True when `sel` refers to the same inspectable as the current selection —
    lets views render an "active" affordance without re-deriving equality. */
export function isSelected(nav: ShellNav, sel: Selection): boolean {
  const s = nav.selection;
  if (!s || s.kind !== sel.kind) return false;
  switch (s.kind) {
    case 'bus':
      return s.busId === (sel as { busId: string }).busId;
    case 'section':
      return s.sectionId === (sel as { sectionId: string }).sectionId;
  }
}

/** Parse the deep-links from a query string: `?view=` (workspace view) and
    `?settings=` (Settings-modal section). Unknown values are dropped. The retired
    `?view=patch` redirects to the Settings modal — the patch surface lives there now. */
export function parseSearch(search: string): Partial<Pick<ShellNav, 'view' | 'settings'>> {
  const p = new URLSearchParams(search);
  const out: Partial<Pick<ShellNav, 'view' | 'settings'>> = {};
  const v = p.get('view');
  if (v && (VIEWS as readonly string[]).includes(v)) out.view = v as View;
  else if (v === 'patch') out.settings = 'outputs'; // closest analogue of the old patch surface
  const s = p.get('settings');
  if (s && (SETTINGS_PANES as readonly string[]).includes(s)) out.settings = s as SettingsPane;
  return out;
}
