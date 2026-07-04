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
  /** The voice-bus host, or `null` in legacy mode. */
  voiceHost: VoiceEngineHost | null;
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
  if (!deps.voiceHost) return;
  deps.voiceHost.applyInput({ kind: 'recallSection', songId: target.songId, sectionId: target.sectionId });
  deps.broadcastJson({ t: 'input', kind: monitor.kind, label: monitor.label, value: monitor.value });
}

/**
 * Voice-mode input dispatch (programChange / cc / setShow / key / recallSection / midi /
 * osc, plus the global transport recalls). Returns `true` when `msg` has been fully
 * handled (the caller should stop); `false` when the caller should fall through to the
 * legacy reducer path.
 *
 * In legacy mode (`voiceHost === null`) the voice-only message types are consumed as
 * no-ops (returns `true`), while midi/osc fall through (returns `false`) so the legacy
 * reducer drives them.
 */
export function handleVoiceInput(msg: ClientMessage, deps: VoiceInputDeps): boolean {
  const { voiceHost } = deps;
  if (voiceHost) {
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
        voiceHost.applyInput({ kind: 'noteOn', note: msg.note, velocity: msg.velocity / 127 });
      } else {
        voiceHost.applyInput({ kind: 'noteOff', note: msg.note });
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
    // Any other message falls through to the legacy reducer (it still backs structural edits).
    return false;
  }

  if (
    msg.t === 'setShow' ||
    msg.t === 'key' ||
    msg.t === 'fireGraph' ||
    msg.t === 'recallSection' ||
    msg.t === 'cc' ||
    msg.t === 'programChange'
  ) {
    // These only apply to the voice engine; ignore in legacy mode.
    return true;
  }
  return false;
}

/**
 * Voice mode: the legacy reducer mutates the shared project, but the voice host owns the
 * live render + output. Propagate kit/output/input-map edits so real device behaviour
 * changes without a restart. (`setKitOutputs` has no legacy reducer case, so the host
 * mutation here is what actually applies it.) Other message types are no-ops.
 */
export function propagateToVoiceHost(voiceHost: VoiceEngineHost, msg: ClientMessage): void {
  switch (msg.t) {
    case 'setKitTransform':
      voiceHost.setKitTransform(msg.drumId, {
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
        ...(msg.rotation !== undefined ? { rotation: msg.rotation } : {}),
        ...(msg.localSpinDeg !== undefined ? { localSpinDeg: msg.localSpinDeg } : {}),
        ...(msg.startAngleDeg !== undefined ? { startAngleDeg: msg.startAngleDeg } : {}),
        ...(msg.pixelsPerHoop !== undefined ? { pixelsPerHoop: msg.pixelsPerHoop } : {}),
        ...(msg.flip !== undefined ? { flip: msg.flip } : {}),
      });
      break;
    case 'setKitGlobal':
      voiceHost.setKitGlobal({
        ...(msg.mirror !== undefined ? { mirror: msg.mirror } : {}),
      });
      break;
    case 'setKitOutputs':
      voiceHost.setKitOutputs(msg.outputs);
      break;
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
      break;
    case 'setInputMap':
      voiceHost.setInputMap(msg.inputMap);
      break;
  }
}
