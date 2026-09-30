/* Reactive wrapper over the pure shell-nav reducer. Holds the navigation state
   as a single $state object and forwards every transition to shell-nav, so the
   invariant (view-switch clears selection) has exactly one home and stays
   unit-tested in node. Components read shell.view / shell.selection and call
   the setters. */

import * as nav from './shell-nav';
import type { Selection, SettingsPane, ShellNav, View } from './shell-nav';
import type { MapKeySession } from './map-mode/map-keys';

export type { Selection, SettingsPane, View } from './shell-nav';

export class ShellStore {
  private s = $state<ShellNav>(nav.initialNav());

  constructor(init?: Partial<Pick<ShellNav, 'view' | 'settings'>>) {
    this.s = nav.initialNav(init);
  }

  get view(): View {
    return this.s.view;
  }
  get selection(): Selection | null {
    return this.s.selection;
  }
  /** The open Settings-modal section; null = modal closed. */
  get settingsPane(): SettingsPane | null {
    return this.s.settings;
  }

  setView(view: View): void {
    this.s = nav.setView(this.s, view);
  }
  openSettings(pane?: SettingsPane): void {
    this.s = nav.openSettings(this.s, pane);
  }
  closeSettings(): void {
    this.s = nav.closeSettings(this.s);
  }
  select(selection: Selection): void {
    this.s = nav.select(this.s, selection);
  }
  clearSelection(): void {
    this.s = nav.clearSelection(this.s);
  }

  /** MIDI-map mode (S07b): while on, the map-mode overlay turns clicks into arm-for-learn. */
  get mapMode(): boolean {
    return this.s.mapMode;
  }
  /** Enter / leave map mode. Leaving resets the mounted map session (disarm + cancel learn),
      so the TopBar toggle, Escape and the shortcut all exit through this one path. */
  setMapMode(on: boolean): void {
    if (!on && this.s.mapMode) this.session?.reset();
    this.s = nav.setMapMode(this.s, on);
  }
  toggleMapMode(): void {
    this.setMapMode(!this.s.mapMode);
  }

  /** The mounted map-mode controller's keyboard face, published by MapModeOverlay (null when
      none is mounted) — how the app keyboard dispatcher learns and performs key mappings. Plain
      (not $state): only event handlers read it. */
  private session: MapKeySession | null = null;
  get mapSession(): MapKeySession | null {
    return this.session;
  }
  setMapSession(session: MapKeySession | null): void {
    this.session = session;
  }

  /** True when `sel` is the currently-inspected thing (for "active" affordances). */
  isSelected(sel: Selection): boolean {
    return nav.isSelected(this.s, sel);
  }
}
