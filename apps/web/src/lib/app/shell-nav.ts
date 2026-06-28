/* Shell navigation model — the unified app's view-router + dock + Inspector
   selection, as a PURE reducer (no runes, no DOM) so the invariants are unit-
   testable in the node test env. `shell-store.svelte.ts` is a thin rune wrapper
   over this. Mirrors the show-builder split: pure core, reactive shell.

   The app is mode-less: there is no Perform/Author mode — it is simply whichever
   `view` is selected (Perform being one of them). The invariants live here once
   (locality): switching views clears the Inspector selection, and selecting
   anything surfaces the Inspector tab. */

export type View = 'perform' | 'objects' | 'sections' | 'trigger' | 'patch';
export type DockTab = 'inspector' | 'monitor';

/** A node id in the Patch Graph (device routing). These are stage-prefixed strings
    minted by `patch-topology.ts` — `input` · `trigger:<drumId>` · `zone:<drumId>:<zone>`
    · `drum:<drumId>` · `hoop:<drumId>:<n>` · `dataline:<n>` · `output:<n>` · `controller`
    — so the graph can name any node without a closed enum. */
export type PatchNodeId = string;

/** What is loaded into the right-dock Inspector: a node in the active trigger
    graph, a Patch-graph device node, a layer/bus, or a setlist section (rename +
    read-only transport-recall info). `null` = nothing selected. */
export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'patch'; nodeId: PatchNodeId }
  | { kind: 'bus'; busId: string }
  | { kind: 'section'; sectionId: string };

export interface ShellNav {
  view: View;
  dock: DockTab;
  selection: Selection | null;
}

export const VIEWS: readonly View[] = ['perform', 'objects', 'sections', 'trigger', 'patch'];

export function initialNav(init: Partial<Pick<ShellNav, 'view'>> = {}): ShellNav {
  return {
    view: init.view ?? 'trigger',
    dock: 'inspector',
    selection: null,
  };
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
    case 'section':
      return s.sectionId === (sel as { sectionId: string }).sectionId;
  }
}

/** Parse the view deep-link from a query string (?view=). Unknown values are dropped. */
export function parseSearch(search: string): Partial<Pick<ShellNav, 'view'>> {
  const p = new URLSearchParams(search);
  const out: Partial<Pick<ShellNav, 'view'>> = {};
  const v = p.get('view');
  if (v && (VIEWS as readonly string[]).includes(v)) out.view = v as View;
  return out;
}
