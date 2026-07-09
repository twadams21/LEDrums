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
    map read/write, the trigger-source setter, and the selected graph's nodes (for a cc-node bind). */

import type { GraphNode, TriggerSource } from './sim';
import { initMidi, type MidiDeviceInfo, type MidiEventHandler, type MidiInitResult } from '../midi/webmidi';
import type { InputMap } from '@ledrums/core';

/** MIDI controller 0 is reserved for global section recall (see server `SECTION_RECALL_CC`),
    so a CC source node may never bind it (S37) — the editor rejects it and learn skips it. */
const RESERVED_CC_CONTROLLER = 0;

/** What an armed MIDI-learn is waiting to bind: a zone's note, a trigger node's source, or (S37) a
    CC source node's controller. The store's inspectors arm one, then the next matching input binds it. */
export type MidiLearnTarget =
  | { kind: 'zone'; drumId: string; slot: number }
  | { kind: 'trigger'; graphKey: string }
  | { kind: 'cc-node'; nodeId: string }; // S37: bind a CC source node to the next incoming CC

/** The store-side surface the learn bind depends on — injected so the controller stays free of the
    project/routing plumbing and the graph-editing internals it drives. */
export interface MidiControllerHost {
  /** Whether this client is a read-only viewer (S2) — arming and binding no-op then. */
  isViewer(): boolean;
  /** The live patch input map (zone note / CC routing), or null before a project loads. */
  getInputMap(): InputMap | null;
  /** Replace the input map (a zone-note learn writes the new binding through here). */
  setInputMap(inputMap: InputMap): void;
  /** Set a trigger node's source (a trigger learn binds `{ kind: 'midi', note }` through here). */
  setTriggerSource(graphKey: string, source: TriggerSource): void;
  /** The selected graph's nodes, for a cc-node learn to find and rebind its controller. */
  selectedGraphNodes(): readonly GraphNode[] | undefined;
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

  /** Bind an armed note-learn to `note`: a zone target writes the note→drum map, a trigger target
      sets the node's midi source. A cc-node target ignores notes (it waits for {@link applyCcLearn}).
      No-op for a viewer or when nothing is armed. Called by the store's channel-gated input paths. */
  applyNoteLearn(note: number): void {
    const target = this.learnTarget;
    if (!target || this.host.isViewer()) return;
    if (target.kind === 'zone') {
      const inputMap = this.host.getInputMap();
      if (!inputMap) return;
      const rest = inputMap.midiNotes.filter(
        (n) => !(n.drumId === target.drumId && n.slot === target.slot),
      );
      this.host.setInputMap({
        ...inputMap,
        midiNotes: [...rest, { note, drumId: target.drumId, slot: target.slot }],
      });
    } else if (target.kind === 'trigger') {
      this.host.setTriggerSource(target.graphKey, { kind: 'midi', note });
    } else {
      return; // a CC-node learn target ignores notes — it binds on the next CC (applyCcLearn)
    }
    this.learnTarget = null;
  }

  /** Bind an armed cc-node learn target to the next incoming controller (S37). Controller 0 is
      reserved for section recall, so it is never learned — the target stays armed for a real CC.
      No-op unless a `cc-node` learn is armed and its node still exists. */
  applyCcLearn(controller: number): void {
    const target = this.learnTarget;
    if (!target || target.kind !== 'cc-node' || this.host.isViewer()) return;
    if (controller === RESERVED_CC_CONTROLLER) return; // reserved → keep waiting for a real CC
    const node = this.host.selectedGraphNodes()?.find((n) => n.id === target.nodeId);
    if (!node || node.kind !== 'cc') return;
    node.ccController = controller;
    this.learnTarget = null;
  }
}
