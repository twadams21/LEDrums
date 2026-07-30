/* The shell's navigation state — which view the workspace shows and what is loaded into the
   inspector — as a rune class. Components read `shell.view` / `shell.selection` and call the
   transitions.

   Until INIT-02 S17 this was a thin wrapper forwarding each transition to a pure reducer in
   shell-nav.ts. The reducer had one caller and its stated reason ("unit-testable in node") no
   longer holds — rune classes construct fine in this repo's node test env — so the transitions
   are inlined here, next to the fields they transition, and shell-nav.ts keeps only the shared
   vocabulary plus the URL parser. */

import type { Selection, View } from './shell-nav';
import type { PatchRouting } from './patch-routing';

export type { PatchNodeId, Selection, View } from './shell-nav';

export class ShellStore {
  private currentView = $state<View>('trigger');
  private currentSelection = $state<Selection | null>(null);

  /** The LIVE Patch-graph routing (graph-node-id-keyed datalines + outputs), published by
      PatchGraphView while the patch view is mounted, so the Inspector's first/last-pixel
      read-out reflects the live wiring — including just-added palette lines and un-remounted
      reorders — rather than a re-chunked snapshot of committed outputs (whose synthetic
      dataline ids never match the selected node id). null when no patch view is mounted
      (a patch node is only selectable from within it, so reads are always fresh). */
  private liveRouting = $state<PatchRouting | null>(null);

  constructor(init: { view?: View } = {}) {
    this.currentView = init.view ?? 'trigger';
  }

  get view(): View {
    return this.currentView;
  }
  get selection(): Selection | null {
    return this.currentSelection;
  }
  /** The live Patch-graph routing for the Inspector read-out (see {@link liveRouting}). */
  get patchRouting(): PatchRouting | null {
    return this.liveRouting;
  }
  /** PatchGraphView publishes its live routing here (null on unmount). */
  setPatchRouting(routing: PatchRouting | null): void {
    this.liveRouting = routing;
  }

  /** Switch the workspace view; resets the Inspector selection (wireframe:
      "switching views resets the Inspector"). No-op when already on the view. */
  setView(view: View): void {
    if (view === this.currentView) return;
    this.currentView = view;
    this.currentSelection = null;
  }

  /** Load something into its inspector surface. */
  select(selection: Selection): void {
    this.currentSelection = selection;
  }

  clearSelection(): void {
    this.currentSelection = null;
  }

  /** True when `sel` refers to the same inspectable as the current selection —
      lets views render an "active" affordance without re-deriving equality. */
  isSelected(sel: Selection): boolean {
    const s = this.currentSelection;
    if (!s || s.kind !== sel.kind) return false;
    switch (s.kind) {
      case 'node':
        return s.nodeId === (sel as { nodeId: string }).nodeId;
      case 'patch':
        return s.nodeId === (sel as { nodeId: string }).nodeId;
      case 'bus':
        return s.busId === (sel as { busId: string }).busId;
      case 'section':
        return s.sectionId === (sel as { sectionId: string }).sectionId;
    }
  }
}
