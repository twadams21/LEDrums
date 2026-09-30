/** MIDI input + MIDI-learn controller (R6/S37) — the WebMIDI device layer plus the learn-arming
    machinery behind the settings device list and the inspectors' "learn the next hit" buttons,
    extracted from the store god-file (R21, store split 2/5) into a constructor-injected controller.
    Owns the browser MIDI on-ramp (open the access handle, surface the live device list + availability
    for the settings empty-state) and the learn arm (which target waits to bind the next note / CC).

    Reactivity lives here (Svelte 5 runes fields); the store delegates via getters/forwarders so its
    public surface is unchanged. The store keeps the per-event forwarding itself (`forwardMidi` /
    `receiveInputEcho`) because that path is entangled with the offline sim, the S04 activity badges,
    and the local-fire preview — the ambiguous "routing fed by MIDI events" the split leaves in place;
    it calls back into {@link applyNoteLearn} / {@link applyCcLearn} once it has channel-gated. The
    learn binds through a thin {@link MidiControllerHost}: whether we're a read-only viewer, the input
    map read/write, and the binding writers each target kind needs. */

import { initMidi, type MidiDeviceInfo, type MidiEventHandler, type MidiInitResult } from '../midi/webmidi';
import type { GlobalControlAction, GlobalControlBinding, InputMap } from '@ledrums/core';
import type { MapTarget } from './map-api';

/** MIDI controller 0 is reserved for global section recall (see server `SECTION_RECALL_CC`),
    so a CC learn never binds it — the target stays armed for a real CC. */
const RESERVED_CC_CONTROLLER = 0;

/** What an armed MIDI-learn is waiting to bind. The settings and Effect cards arm one, then the
    next matching input binds it. */
export type MidiLearnTarget =
  | { kind: 'zone'; drumId: string; slot: number }
  /** An app-general control's MIDI note (Settings → Global controls). */
  | { kind: 'global-control'; action: GlobalControlAction }
  /** An app-general CONTINUOUS control's MIDI CC (master brightness). Separate from the
      note variant because it binds off a CC message, not a note. */
  | { kind: 'global-control-cc'; action: GlobalControlAction }
  /** Effect chains (S05): a Cue Effect's MIDI source — the next note OR controller binds it
      (whichever arrives first; CC 0 stays reserved). */
  | { kind: 'cue'; effectId: string }
  /** Effect chains (S07): MIDI-map mode's armed control — the next note OR controller binds it
      (CC 0 stays reserved). Unlike every other target it stays ARMED after a bind: map mode
      re-binds on each new input until the user disarms (clicks away, Escape, leaves the mode). */
  | { kind: 'map'; target: MapTarget };

/** The store-side surface the learn bind depends on — injected so the controller stays free of the
    project/routing plumbing it drives. */
export interface MidiControllerHost {
  /** Whether this client is a read-only viewer (S2) — arming and binding no-op then. */
  isViewer(): boolean;
  /** The live patch input map (zone note / CC routing), or null before a project loads. */
  getInputMap(): InputMap | null;
  /* The binding writers all return whether the write was ACCEPTED. A `false` means the
     binding guard refused it — the address already belongs to another group (see
     `binding-claims`); the store has already told the user why. Learn reads this so a
     refused note leaves the target ARMED for another try, matching how a reserved CC 0
     keeps a cc-learn waiting instead of silently eating the gesture. */
  /** Replace the input map (a zone-note learn writes the new binding through here). */
  setInputMap(inputMap: InputMap): boolean;
  /** Write one global control's binding (a global-control learn writes its note here). */
  setGlobalControlBinding(action: GlobalControlAction, patch: GlobalControlBinding): boolean;
  /** Set a Cue Effect's MIDI source (a cue learn binds through here — the Effect's undo / guard
      path). Same accepted / refused contract as the other writers. */
  setCueMidiSource(effectId: string, source: { midiNote: number } | { midiCc: number }): boolean;
  /** Bind MIDI-map mode's armed control (the store's `bindTarget` path, which records a refusal
      for the overlay). The arm stays up either way, so the result is not read. */
  bindMapSource(target: MapTarget, source: { midiNote: number } | { midiCc: number }): void;
}

export class MidiController {
  /** The armed learn target, or null when nothing is waiting to bind. Set by {@link startLearn},
      cleared by {@link cancelLearn} or once a matching input binds. */
  learnTarget = $state<MidiLearnTarget | null>(null);
  /** Live WebMIDI input devices for the settings list, refreshed on hot-plug via the initMidi device
      callback (empty until MIDI is requested / when unavailable). */
  devices = $state<MidiDeviceInfo[]>([]);
  /** Whether WebMIDI access succeeded — drives the settings empty-state copy (unavailable ⇒
      browser/permission hint; available+empty ⇒ "connect one"). */
  available = $state(false);
  /** Why WebMIDI is unavailable, when it is (e.g. 'no-api' or an access-error message). */
  unavailableReason = $state<string | undefined>(undefined);

  /** WebMIDI access handle (real hardware → WS). Browser-only, opened in {@link openInput},
      released in {@link release}; null when MIDI is unavailable or not yet requested. */
  private handle: MidiInitResult | null = null;

  constructor(private readonly host: MidiControllerHost) {}

  // --- device layer ---------------------------------------------------------

  /** Open WebMIDI (browser-only) and forward every parsed event via `onEvent`. Never throws: an
      absent API / denied access resolves to an unavailable handle and the flags reflect it. */
  async openInput(onEvent: MidiEventHandler): Promise<void> {
    try {
      this.handle = await initMidi(onEvent, undefined, (devices) => (this.devices = devices));
      this.available = this.handle.available;
      this.unavailableReason = this.handle.reason;
      this.devices = this.handle.devices;
    } catch {
      this.handle = null;
      this.available = false;
      this.unavailableReason = 'access-denied';
      this.devices = [];
    }
  }

  /** Release the MIDI handle and clear the device state (store lifecycle stop). */
  release(): void {
    this.handle?.stop();
    this.handle = null;
    this.devices = [];
    this.available = false;
    this.unavailableReason = undefined;
  }

  // --- learn arm ------------------------------------------------------------

  /** Arm a learn target so the next matching input binds it (S37). No-op for a viewer. */
  startLearn(target: MidiLearnTarget): void {
    if (this.host.isViewer()) return;
    this.learnTarget = target;
  }

  /** Disarm any pending learn. */
  cancelLearn(): void {
    this.learnTarget = null;
  }

  /** Bind an armed note-learn to `note`: a zone target writes the note→drum map, a global control
      its note, a Cue / map target its source. A CC-only target ignores notes (it waits for
      {@link applyCcLearn}). No-op for a viewer or when nothing is armed. Called by the store's
      channel-gated input paths. */
  applyNoteLearn(note: number): void {
    const target = this.learnTarget;
    if (!target || this.host.isViewer()) return;
    let accepted: boolean;
    if (target.kind === 'zone') {
      const inputMap = this.host.getInputMap();
      if (!inputMap) return;
      const rest = inputMap.midiNotes.filter(
        (n) => !(n.drumId === target.drumId && n.slot === target.slot),
      );
      accepted = this.host.setInputMap({
        ...inputMap,
        midiNotes: [...rest, { note, drumId: target.drumId, slot: target.slot }],
      });
    } else if (target.kind === 'global-control') {
      accepted = this.host.setGlobalControlBinding(target.action, { midiNote: note });
    } else if (target.kind === 'cue') {
      accepted = this.host.setCueMidiSource(target.effectId, { midiNote: note });
    } else if (target.kind === 'map') {
      this.host.bindMapSource(target.target, { midiNote: note });
      return; // map learn stays armed (see MidiLearnTarget)
    } else {
      return; // a CC-only learn target ignores notes — it binds on the next CC (applyCcLearn)
    }
    // Refused by the binding guard → stay armed so the next pad hit can bind instead. The
    // store has already said why; disarming here would look like the gesture was lost.
    if (!accepted) return;
    this.learnTarget = null;
  }

  /** Bind an armed CC learn target (a continuous global control, a Cue, a map target) to the next
      incoming controller. Controller 0 is reserved for section recall, so it is never learned —
      the target stays armed for a real CC. */
  applyCcLearn(controller: number): void {
    const target = this.learnTarget;
    if (!target || this.host.isViewer()) return;
    if (controller === RESERVED_CC_CONTROLLER) return; // reserved → keep waiting for a real CC
    if (target.kind === 'global-control-cc') {
      // Same rule as the reserved-CC guard above: a refused CC keeps the target armed.
      if (this.host.setGlobalControlBinding(target.action, { midiCc: controller })) this.learnTarget = null;
      return;
    }
    if (target.kind === 'cue') {
      if (this.host.setCueMidiSource(target.effectId, { midiCc: controller })) this.learnTarget = null;
      return;
    }
    if (target.kind === 'map') {
      this.host.bindMapSource(target.target, { midiCc: controller });
      // map learn stays armed
    }
  }
}
