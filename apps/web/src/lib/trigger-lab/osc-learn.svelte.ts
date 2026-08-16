/* =============================================================================
   OSC LEARN — arm a field, bind the next address heard.

   The OSC counterpart to {@link MidiController}'s note learn, and the app's first:
   until now nothing could learn an OSC address, you had to type it. The seam it
   rides already existed — the server broadcasts every inbound OSC packet as an
   `input` echo, which the store already consumes for the activity badges — so this
   only adds the arm.

   Kept as its OWN controller rather than another branch inside MidiController for
   one behavioural reason: the arms are independent. A global control has a MIDI
   Learn button AND an OSC Learn button, and arming one must not disarm the other,
   so they cannot share a single `learnTarget` slot.

   Asymmetry worth knowing: MIDI learn binds from BOTH the local WebMIDI forward and
   the server echo, because local WebMIDI never round-trips. OSC has no browser
   transport at all — every address arrives via the server — so there is exactly one
   feed here.
   ============================================================================= */
import type { GlobalControlAction, GlobalControlBinding } from '@ledrums/core';

/** What an armed OSC learn is waiting to bind: an app-general control, or one drum zone's
    OSC address. The zone arm mirrors the MIDI zone learn that already existed — typing an
    OSC address by hand was the only way to bind one, which is exactly the thing learn exists
    to avoid (Trent, 2026-08-14). Identity is the SLOT, never the zone's name. */
export type OscLearnTarget =
  | { kind: 'global-control'; action: GlobalControlAction }
  | { kind: 'zone'; drumId: string; slot: number };

/** The store-side surface an OSC bind writes through — injected so this controller
    stays free of the project/routing plumbing. */
export interface OscLearnHost {
  /** Whether this client is a read-only viewer (S2) — arming and binding no-op then. */
  isViewer(): boolean;
  /** Write one action's binding (routes through the single `setInputMap` path). Returns
      whether the write was ACCEPTED — `false` means the binding guard refused the address
      because another group already owns it (see `binding-claims`). */
  setGlobalControlBinding(action: GlobalControlAction, patch: GlobalControlBinding): boolean;
  /** Write one zone's OSC address — same `setInputMap` gate, same accepted/refused contract. */
  setZoneOscAddress(drumId: string, slot: number, address: string): boolean;
}

export class OscLearnController {
  /** The armed target, or null when nothing is waiting to bind. */
  target = $state<OscLearnTarget | null>(null);

  constructor(private readonly host: OscLearnHost) {}

  /** Arm a target so the next heard address binds it. No-op for a viewer. */
  start(target: OscLearnTarget): void {
    if (this.host.isViewer()) return;
    this.target = target;
  }

  /** Disarm any pending learn. */
  cancel(): void {
    this.target = null;
  }

  /**
   * Bind the armed target to `address` and disarm. An empty address is ignored and
   * leaves the target ARMED — a malformed packet should not silently consume the
   * arm and leave the user staring at an unchanged field. An address REFUSED by the
   * binding guard leaves it armed for the same reason: the gesture was heard, it just
   * could not bind, and the store has already said why.
   */
  apply(address: string): void {
    const target = this.target;
    if (!target || this.host.isViewer()) return;
    const trimmed = address.trim();
    if (!trimmed) return;
    const bound =
      target.kind === 'global-control'
        ? this.host.setGlobalControlBinding(target.action, { oscAddress: trimmed })
        : this.host.setZoneOscAddress(target.drumId, target.slot, trimmed);
    if (!bound) return;
    this.target = null;
  }
}
