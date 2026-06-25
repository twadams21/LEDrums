/* Shell navigation model — the unified app's view-router + dock + Inspector
   selection, as a PURE reducer (no runes, no DOM) so the invariants are unit-
   testable in the node test env. `shell-store.svelte.ts` is a thin rune wrapper
   over this. Mirrors the show-builder split: pure core, reactive shell.

   The invariants live here once (locality): switching views clears the Inspector
   selection, and selecting anything surfaces the Inspector tab. */

export type Mode = 'perform' | 'author';
export type View = 'trigger' | 'patch' | 'sections' | 'kit';
export type DockTab = 'inspector' | 'monitor';

/** A node id in the Patch Graph (device routing). These are stage-prefixed strings
    minted by `patch-topology.ts` — `input` · `trigger:<drumId>` · `zone:<drumId>:<zone>`
    · `drum:<drumId>` · `hoop:<drumId>:<n>` · `dataline:<n>` · `output:<n>` · `controller`
    — so the graph can name any node without a closed enum. */
export type PatchNodeId = string;

/** What is loaded into the right-dock Inspector: a node in the active trigger
    graph, a Patch-graph device node, or a layer/bus. `null` = nothing selected. */
export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'patch'; nodeId: PatchNodeId }
  | { kind: 'bus'; busId: string };

export interface ShellNav {
  mode: Mode;
  view: View;
  dock: DockTab;
  selection: Selection | null;
}

export const MODES: readonly Mode[] = ['perform', 'author'];
export const VIEWS: readonly View[] = ['trigger', 'patch', 'sections', 'kit'];

export function initialNav(init: Partial<Pick<ShellNav, 'mode' | 'view'>> = {}): ShellNav {
  return {
    mode: init.mode ?? 'author',
    view: init.view ?? 'trigger',
    dock: 'inspector',
    selection: null,
  };
}

export function setMode(nav: ShellNav, mode: Mode): ShellNav {
  if (mode === nav.mode) return nav;
  return { ...nav, mode };
}

/** Switch the workspace view; resets the Inspector selection (wireframe:
    "switching views resets the Inspector"). No-op when already on the view. */
export function setView(nav: ShellNav, view: View): ShellNav {
  if (view === nav.view) return nav;
  return { ...nav, view, selection: null };
}

export function setDock(nav: ShellNav, dock: DockTab): ShellNav {
  if (dock === nav.dock) return nav;
  return { ...nav, dock };
}

/** Load something into the Inspector and surface it (forces the Inspector tab). */
export function select(nav: ShellNav, selection: Selection): ShellNav {
  return { ...nav, selection, dock: 'inspector' };
}

export function clearSelection(nav: ShellNav): ShellNav {
  if (nav.selection === null) return nav;
  return { ...nav, selection: null };
}

/** True when `sel` refers to the same inspectable as the current selection —
    lets views render an "active" affordance without re-deriving equality. */
export function isSelected(nav: ShellNav, sel: Selection): boolean {
  const s = nav.selection;
  if (!s || s.kind !== sel.kind) return false;
  switch (s.kind) {
    case 'node':
      return s.nodeId === (sel as { nodeId: string }).nodeId;
    case 'patch':
      return s.nodeId === (sel as { nodeId: PatchNodeId }).nodeId;
    case 'bus':
      return s.busId === (sel as { busId: string }).busId;
  }
}

const MODE_ALIASES: Record<string, Mode> = {
  perform: 'perform',
  performance: 'perform', // legacy ?mode=performance deep-link
  author: 'author',
  authoring: 'author', // legacy ?mode=authoring deep-link
};

/** Parse mode/view deep-links from a query string (?mode=&view=), tolerating the
    legacy `performance`/`authoring` mode spellings. Unknown values are dropped. */
export function parseSearch(search: string): Partial<Pick<ShellNav, 'mode' | 'view'>> {
  const p = new URLSearchParams(search);
  const out: Partial<Pick<ShellNav, 'mode' | 'view'>> = {};
  const m = p.get('mode');
  if (m && MODE_ALIASES[m]) out.mode = MODE_ALIASES[m];
  const v = p.get('view');
  if (v && (VIEWS as readonly string[]).includes(v)) out.view = v as View;
  return out;
}
