import {
  oscRecall,
  parseSectionRecallAddress,
  programChangeRecall,
  sectionIndexRecall,
  SECTION_RECALL_CC,
  type RecallTarget,
} from '../input-router';
import type { VoiceEngineHost } from '../voice-engine-host';
import type { ClientMessage, ServerMessage } from '../ws-protocol';

/** Collaborators the voice-input handler needs from the server wiring. */
export interface VoiceInputDeps {
  /** THE host. Not nullable since S12: there is no legacy mode for it to be absent in. */
  voiceHost: VoiceEngineHost;
  /** Broadcast a JSON message to all clients (`broadcastJson`). */
  broadcastJson(msg: ServerMessage): void;
}

/**
 * Apply a resolved global transport recall to the voice engine + echo it to the input
 * monitor. Reuses the engine's existing `recallSection` input (which also activates the
 * song), so a Program Change / CC#0 / OSC recall drives the same path the UI does. Shared
 * by the WS voice handler and the raw OSC-input listener.
 */
export function applyTransportRecall(
  deps: VoiceInputDeps,
  target: RecallTarget,
  monitor: { kind: 'midi' | 'osc'; label: string; value: number },
): void {
  deps.voiceHost.applyInput({ kind: 'recallSection', songId: target.songId, sectionId: target.sectionId });
  deps.broadcastJson({ t: 'input', kind: monitor.kind, label: monitor.label, value: monitor.value });
}

/**
 * Engine-input dispatch (programChange / cc / setShow / key / recallSection / midi / osc, plus the
 * global transport recalls). Returns `true` when `msg` has been fully handled (the caller stops);
 * `false` when the caller should fall through to {@link applyStructuralMessage}.
 *
 * S12 deleted the legacy arm this used to have — a block that swallowed the voice-only message
 * types as no-ops when `voiceHost` was null. There is no such mode now, so an input either applies
 * or falls through; it can no longer be silently consumed.
 */
export function handleVoiceInput(msg: ClientMessage, deps: VoiceInputDeps): boolean {
  const { voiceHost } = deps;
  // Global transport recall — STEP 0, before the per-trigger zone-map. A Program Change
  // selects a song (+ its first section); CC#0 recalls a section in the active song.
  if (msg.t === 'programChange') {
    const target = programChangeRecall(voiceHost.getShow(), msg.value);
    if (target) applyTransportRecall(deps, target, { kind: 'midi', label: `PC ${msg.value}`, value: msg.value });
    return true;
  }
  if (msg.t === 'cc') {
    if (msg.controller === SECTION_RECALL_CC) {
      const target = sectionIndexRecall(voiceHost.getShow(), voiceHost.getActiveSongId(), msg.value);
      if (target) applyTransportRecall(deps, target, { kind: 'midi', label: `CC0 ${msg.value}`, value: msg.value });
    } else {
      // S37: any other controller feeds the engine's CC value table (queued input event),
      // where `cc` modulation sources read it per frame. Determinism preserved — same events,
      // same frames. Controller 0 is reserved above for section recall and never reaches here.
      voiceHost.applyInput({ kind: 'cc', controller: msg.controller, value: msg.value, channel: msg.channel });
    }
    return true;
  }
  if (msg.t === 'setShow') {
    voiceHost.setShow(msg.show);
    return true;
  }
  if (msg.t === 'key') {
    voiceHost.applyInput({ kind: 'key', drumId: msg.drumId, zone: msg.zone, velocity: msg.velocity });
    deps.broadcastJson({ t: 'input', kind: 'midi', label: `${msg.drumId}:${msg.zone ?? ''}`, value: msg.velocity ?? 1 });
    return true;
  }
  if (msg.t === 'fireGraph') {
    // Keyboard performance intent: fire the EXACT authored graph, no re-resolution. The
    // engine validates the key (emits `graph-missed` → "No graph resolved" on a stale key)
    // and emits the normal input-resolved / graph-fired diagnostics for a valid one. No
    // `input` broadcast: the fire is surfaced by those diagnostics + the server ingress line
    // (`monitorInput` in main.ts), so there is no note/address to echo for MIDI-learn.
    voiceHost.applyInput({ kind: 'fireGraph', graphKey: msg.graphKey, velocity: msg.velocity });
    return true;
  }
  if (msg.t === 'recallSection') {
    voiceHost.applyInput({ kind: 'recallSection', songId: msg.songId, sectionId: msg.sectionId });
    return true;
  }
  if (msg.t === 'midi') {
    if (msg.on && msg.velocity > 0) {
      voiceHost.applyInput({ kind: 'noteOn', note: msg.note, velocity: msg.velocity / 127, channel: msg.channel });
    } else {
      voiceHost.applyInput({ kind: 'noteOff', note: msg.note, channel: msg.channel });
    }
    deps.broadcastJson({ t: 'input', kind: 'midi', label: `note ${msg.note}`, value: msg.velocity / 127, note: msg.note, channel: msg.channel });
    return true;
  }
  if (msg.t === 'osc') {
    // A section-recall address is a reserved global convention: it is ALWAYS consumed
    // here (recall on a valid index, no-op when out of range) and never falls through to
    // the zone-map. Any other address is a normal OSC input.
    if (parseSectionRecallAddress(msg.address) !== null) {
      const target = oscRecall(voiceHost.getShow(), msg.address, msg.value);
      if (target) applyTransportRecall(deps, target, { kind: 'osc', label: msg.address, value: msg.value });
      return true;
    }
    voiceHost.applyInput({ kind: 'osc', address: msg.address, value: msg.value });
    deps.broadcastJson({ t: 'input', kind: 'osc', label: msg.address, value: msg.value });
    return true;
  }
  // Anything else is not an input — it falls through to the structural reducer.
  return false;
}

/**
 * THE structural reducer (S8). Was `propagateToVoiceHost`, a bridge that forwarded edits the
 * legacy reducer had already applied; it is now the SOLE writer of the live Project, which the
 * voice host owns. Every arm here mutates the authoritative project in place and rebuilds
 * whatever the edit invalidated (geometry, DMX map, output settings), so no caller has to
 * remember a follow-up `reloadOutputSettings`.
 *
 * Returns `true` when `msg` was a structural edit this reducer applied — the caller's signal to
 * broadcast fresh `state` and mark the autosaver dirty — and `false` for anything else (inputs,
 * reads, project IO, and the fourteen composition messages no client sends, which S11 deletes
 * outright along with their protocol variants).
 */
export function applyStructuralMessage(voiceHost: VoiceEngineHost, msg: ClientMessage): boolean {
  switch (msg.t) {
    case 'setKitTransform':
      voiceHost.setKitTransform(msg.drumId, {
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
        ...(msg.rotation !== undefined ? { rotation: msg.rotation } : {}),
        ...(msg.localSpinDeg !== undefined ? { localSpinDeg: msg.localSpinDeg } : {}),
        ...(msg.startAngleDeg !== undefined ? { startAngleDeg: msg.startAngleDeg } : {}),
        ...(msg.pixelsPerHoop !== undefined ? { pixelsPerHoop: msg.pixelsPerHoop } : {}),
        // S5: hoopSpacingMm + diameterIn were absent from this spread while the legacy arm
        // forwarded both — a rig calibration of hoop spacing or shell diameter reached the
        // persisted project but never the LIVE voice geometry until a restart.
        ...(msg.hoopSpacingMm !== undefined ? { hoopSpacingMm: msg.hoopSpacingMm } : {}),
        ...(msg.diameterIn !== undefined ? { diameterIn: msg.diameterIn } : {}),
        ...(msg.flip !== undefined ? { flip: msg.flip } : {}),
        ...(msg.color !== undefined ? { color: msg.color } : {}),
      });
      return true;
    case 'setKitGlobal':
      voiceHost.setKitGlobal({
        ...(msg.expanded !== undefined ? { expanded: msg.expanded } : {}),
        ...(msg.ledDensityPxPerM !== undefined ? { ledDensityPxPerM: msg.ledDensityPxPerM } : {}),
        ...(msg.hoopCount !== undefined ? { hoopCount: msg.hoopCount } : {}),
        ...(msg.defaultHoopSpacingMm !== undefined ? { defaultHoopSpacingMm: msg.defaultHoopSpacingMm } : {}),
        ...(msg.maxPixelsPerOutput !== undefined ? { maxPixelsPerOutput: msg.maxPixelsPerOutput } : {}),
      });
      return true;
    case 'setHoopConfig':
      voiceHost.setHoopConfig(msg.drumId, msg.hoopIndex, {
        ...(msg.pixelCount !== undefined ? { pixelCount: msg.pixelCount } : {}),
        ...(msg.reverse !== undefined ? { reverse: msg.reverse } : {}),
      });
      return true;
    case 'setKitOutputs':
      voiceHost.setKitOutputs(msg.outputs);
      return true;
    case 'setKitNodeLayout':
      voiceHost.setKitNodeLayout(msg.nodeLayout);
      return true;
    case 'setOutput':
      voiceHost.setOutput({
        ...(msg.state !== undefined ? { state: msg.state } : {}),
        ...(msg.protocol !== undefined ? { protocol: msg.protocol } : {}),
        ...(msg.host !== undefined ? { host: msg.host } : {}),
        ...(msg.rgbOrder !== undefined ? { rgbOrder: msg.rgbOrder } : {}),
        ...(msg.fps !== undefined ? { fps: msg.fps } : {}),
        ...(msg.broadcast !== undefined ? { broadcast: msg.broadcast } : {}),
        ...(msg.priority !== undefined ? { priority: msg.priority } : {}),
        ...(msg.port !== undefined ? { port: msg.port } : {}),
        ...(msg.iface !== undefined ? { iface: msg.iface } : {}),
      });
      return true;
    case 'setInputMap':
      voiceHost.setInputMap(msg.inputMap);
      return true;
    case 'setTransport':
      // S5 TRANSPORT AUTHORITY (now the only writer, S8): the voice loop reads
      // `project.composition.transport` every frame via advanceTransport, and this arm is the sole
      // path that writes it. Before S5 there was no voice-side writer at all — a BPM edit reached
      // the loop only through a project reference the legacy reducer happened to share, which
      // splits the moment a patch is adopted.
      voiceHost.setTransport({
        ...(msg.bpm !== undefined ? { bpm: msg.bpm } : {}),
        ...(msg.playing !== undefined ? { playing: msg.playing } : {}),
        ...(msg.beatsPerBar !== undefined ? { beatsPerBar: msg.beatsPerBar } : {}),
      });
      return true;
    default:
      return false;
  }
}
