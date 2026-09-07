import {
  parseSectionRecallAddress,
  SECTION_RECALL_CC,
  zoneForNote,
  zoneForOsc,
  type RecallTarget,
} from '../input-router';
import type { VoiceEngineHost, VoicePartialInput } from '../voice-engine-host';
import type { ClientMessage, ServerMessage } from '../ws-protocol';

/** Collaborators the voice-input handler needs from the server wiring. */
export interface VoiceInputDeps {
  /** The voice-bus host, or `null` in legacy mode. */
  voiceHost: VoiceEngineHost | null;
  /** Broadcast a JSON message to all clients (`broadcastJson`). */
  broadcastJson(msg: ServerMessage): void;
  /** Whether this message came from a read-only client. Viewer keyboard intents are limited to
      the active performance section; editor/server paths retain their existing authority. */
  viewer?: boolean;
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

function queueTransportInput(
  deps: VoiceInputDeps,
  input: VoicePartialInput,
  monitor: { kind: 'midi' | 'osc'; label: string; value: number },
): void {
  if (!deps.voiceHost) return;
  deps.voiceHost.applyInput(input);
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
    // and CC#0 are queued as indices. The engine resolves them against its adopted show and
    // processed active position, not a host-side prediction.
    if (msg.t === 'programChange') {
      queueTransportInput(deps, { kind: 'recallSongIndex', songIndex: msg.value }, { kind: 'midi', label: `PC ${msg.value}`, value: msg.value });
      return true;
    }
    if (msg.t === 'cc') {
      if (msg.controller === SECTION_RECALL_CC) {
        queueTransportInput(deps, { kind: 'recallSectionIndex', sectionIndex: Math.floor(msg.value) }, { kind: 'midi', label: `CC0 ${msg.value}`, value: msg.value });
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
      deps.broadcastJson({
        t: 'input',
        kind: 'midi',
        label: `${msg.drumId}:${msg.zone ?? ''}`,
        value: msg.velocity ?? 1,
        drumId: msg.drumId,
      });
      return true;
    }
    if (msg.t === 'fireGraph') {
      // Keyboard performance intent: fire the EXACT authored graph, no re-resolution. The
      // engine validates the key (emits `graph-missed` → "No graph resolved" on a stale key)
      // and emits the normal input-resolved / graph-fired diagnostics for a valid one. No
      // `input` broadcast: the fire is surfaced by those diagnostics + the server ingress line
      // (`monitorInput` in main.ts), so there is no note/address to echo for MIDI-learn.
      voiceHost.applyInput({ kind: 'fireGraph', graphKey: msg.graphKey, velocity: msg.velocity, viewerOnly: deps.viewer });
      return true;
    }
    if (msg.t === 'recallSection') {
      voiceHost.applyInput({ kind: 'recallSection', songId: msg.songId, sectionId: msg.sectionId });
      return true;
    }
    if (msg.t === 'releaseBus') {
      voiceHost.applyInput({ kind: 'releaseBus', busId: msg.busId });
      return true;
    }
    if (msg.t === 'midi') {
      if (msg.on && msg.velocity > 0) {
        voiceHost.applyInput({ kind: 'noteOn', note: msg.note, velocity: msg.velocity / 127, channel: msg.channel });
      } else {
        voiceHost.applyInput({ kind: 'noteOff', note: msg.note, channel: msg.channel });
      }
      // The echo carries the RAW normalised velocity plus the drum the zone-map claims
      // for this note: the pair a per-drum velocity-curve editor plots (x = what came
      // in, y = read off the curve being edited). Resolved here rather than parsed back
      // out of a label, and deliberately pre-curve — echoing the shaped value would
      // draw the hits on top of the curve instead of under it.
      const pad = zoneForNote(voiceHost.getInputMap(), msg.note);
      deps.broadcastJson({
        t: 'input',
        kind: 'midi',
        label: `note ${msg.note}`,
        value: msg.velocity / 127,
        note: msg.note,
        channel: msg.channel,
        ...(pad ? { drumId: pad.drumId } : {}),
      });
      return true;
    }
    if (msg.t === 'audioFeatures') {
      // GH #214: only the editor's capture is authoritative. A viewer's frame is dropped here (the
      // editor gate already refuses it upstream — this is the belt to that brace). No input echo
      // and no monitor event: a 30 Hz stream must not spam the timeline or the badges.
      if (!deps.viewer) voiceHost.applyInput({ kind: 'audioFeatures', level: msg.level, bass: msg.bass, mids: msg.mids, highs: msg.highs });
      return true;
    }
    if (msg.t === 'osc') {
      // A section-recall address is a reserved global convention: it is ALWAYS consumed
      // here (recall on a valid index, no-op when out of range) and never falls through to
      // the zone-map. Any other address is a normal OSC input.
      if (parseSectionRecallAddress(msg.address) !== null) {
        const parsed = parseSectionRecallAddress(msg.address);
        if (parsed !== null) {
          queueTransportInput(
            deps,
            { kind: 'recallSectionIndex', songIndex: parsed, sectionIndex: Math.floor(msg.value) },
            { kind: 'osc', label: msg.address, value: msg.value },
          );
        }
        return true;
      }
      voiceHost.applyInput({ kind: 'osc', address: msg.address, value: msg.value });
      const oscPad = zoneForOsc(voiceHost.getInputMap(), msg.address);
      deps.broadcastJson({
        t: 'input',
        kind: 'osc',
        label: msg.address,
        value: msg.value,
        ...(oscPad ? { drumId: oscPad.drumId } : {}),
      });
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
    msg.t === 'releaseBus' ||
    msg.t === 'cc' ||
    msg.t === 'programChange' ||
    msg.t === 'audioFeatures'
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
        ...(msg.color !== undefined ? { color: msg.color } : {}),
      });
      break;
    case 'setKitGlobal':
      voiceHost.setKitGlobal({
        ...(msg.mirror !== undefined ? { mirror: msg.mirror } : {}),
        ...(msg.expanded !== undefined ? { expanded: msg.expanded } : {}),
        ...(msg.ledDensityPxPerM !== undefined ? { ledDensityPxPerM: msg.ledDensityPxPerM } : {}),
        ...(msg.hoopCount !== undefined ? { hoopCount: msg.hoopCount } : {}),
        ...(msg.defaultHoopSpacingMm !== undefined ? { defaultHoopSpacingMm: msg.defaultHoopSpacingMm } : {}),
        ...(msg.maxPixelsPerOutput !== undefined ? { maxPixelsPerOutput: msg.maxPixelsPerOutput } : {}),
      });
      break;
    case 'setHoopConfig':
      voiceHost.setHoopConfig(msg.drumId, msg.hoopIndex, {
        ...(msg.pixelCount !== undefined ? { pixelCount: msg.pixelCount } : {}),
        ...(msg.reverse !== undefined ? { reverse: msg.reverse } : {}),
      });
      break;
    case 'setKitOutputs':
      voiceHost.setKitOutputs(msg.outputs);
      break;
    case 'setKitNodeLayout':
      voiceHost.setKitNodeLayout(msg.nodeLayout);
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
