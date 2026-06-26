/* Reactive wrapper over the pure shell-nav reducer. Holds the navigation state
   as a single $state object and forwards every transition to shell-nav, so the
   invariants (view-switch clears selection, select surfaces the Inspector) have
   exactly one home and stay unit-tested in node. Components read shell.mode /
   shell.view / shell.dock / shell.selection and call the setters. */

import * as nav from './shell-nav';
import type { DockTab, Mode, Selection, ShellNav, View } from './shell-nav';
import type { PatchRouting } from './patch-routing';

export type { DockTab, Mode, PatchNodeId, Selection, View } from './shell-nav';

export class ShellStore {
  private s = $state<ShellNav>(nav.initialNav());

  /** The LIVE Patch-graph routing (graph-node-id-keyed datalines + outputs), published by
      PatchGraphView while the patch view is mounted, so the Inspector's first/last-pixel
      read-out reflects the live wiring — including just-added palette lines and un-remounted
      reorders — rather than a re-chunked snapshot of committed outputs (whose synthetic
      dataline ids never match the selected node id). null when no patch view is mounted
      (a patch node is only selectable from within it, so reads are always fresh). */
  private liveRouting = $state<PatchRouting | null>(null);

  constructor(init?: Partial<Pick<ShellNav, 'mode' | 'view'>>) {
    this.s = nav.initialNav(init);
  }

  get mode(): Mode {
    return this.s.mode;
  }
  get view(): View {
    return this.s.view;
  }
  get dock(): DockTab {
    return this.s.dock;
  }
  get selection(): Selection | null {
    return this.s.selection;
  }
  /** The live Patch-graph routing for the Inspector read-out (see {@link liveRouting}). */
  get patchRouting(): PatchRouting | null {
    return this.liveRouting;
  }
  /** PatchGraphView publishes its live routing here (null on unmount). */
  setPatchRouting(routing: PatchRouting | null): void {
    this.liveRouting = routing;
  }

  setMode(mode: Mode): void {
    this.s = nav.setMode(this.s, mode);
  }
  setView(view: View): void {
    this.s = nav.setView(this.s, view);
  }
  setDock(dock: DockTab): void {
    this.s = nav.setDock(this.s, dock);
  }
  select(selection: Selection): void {
    this.s = nav.select(this.s, selection);
  }
  clearSelection(): void {
    this.s = nav.clearSelection(this.s);
  }

  /** True when `sel` is the currently-inspected thing (for "active" affordances). */
  isSelected(sel: Selection): boolean {
    return nav.isSelected(this.s, sel);
  }
}
