import { SLOT_LABELS, type Engine, type InputEvent, type InputMap } from '@ledrums/core';
import type { OscEvent } from '@ledrums/io';
import type { ClientMessage } from './ws-protocol';

export interface ReduceResult {
  /** True when the change alters structure and clients should receive a fresh `state`. */
  structural: boolean;
  /** Optional monitor echo for the input panel. */
  monitor?: { kind: 'midi' | 'osc'; label: string; value: number };
}

/** A drum-zone pad resolved from the patch zone-map (the pad-bound graph it fires). */
export interface ZonePad {
  drumId: string;
  zone: string;
}

/** Map a trigger slot index to a voice zone label (clamped into range). */
function slotToZone(slot: number): string {
  return SLOT_LABELS[Math.max(0, Math.min(SLOT_LABELS.length - 1, slot))] ?? SLOT_LABELS[0];
}

/**
 * Zone-map resolution — PINNED precedence STEP 1. Resolve a raw MIDI note to its
 * `(drumId, zone)` pad via the patch {@link InputMap} (`midiNotes`, keyed `(drumId,
 * slot)` → zone label). A match fires the pad-bound graph (the padKey path) and the
 * caller STOPS; a miss (`null`) means the caller forwards the raw note so the engine can
 * fire a graph bound DIRECTLY to it by its trigger source (step 2) — never both.
 */
export function zoneForNote(inputMap: InputMap, note: number): ZonePad | null {
  const m = inputMap.midiNotes.find((x) => x.note === note);
  return m ? { drumId: m.drumId, zone: slotToZone(m.slot) } : null;
}

/** Zone-map resolution (step 1) for OSC: resolve an address to its `(drumId, zone)` pad
    via the patch {@link InputMap} `oscMap`, else `null` (forward raw for direct binding). */
export function zoneForOsc(inputMap: InputMap, address: string): ZonePad | null {
  const m = inputMap.oscMap.find((x) => x.address === address);
  return m ? { drumId: m.drumId, zone: slotToZone(m.slot) } : null;
}

/** Convert a WS MIDI message into a time-stamped engine event (velocity 0..127 → 0..1). */
export function midiToEvent(note: number, velocity: number, on: boolean, timeMs: number): InputEvent {
  if (on && velocity > 0) return { kind: 'noteOn', note, velocity: velocity / 127, timeMs };
  return { kind: 'noteOff', note, timeMs };
}

/** Convert an inbound OSC event into an engine event (first numeric arg as value). */
export function oscToEvent(e: OscEvent, timeMs: number): InputEvent | null {
  const first = e.args.find((a) => typeof a === 'number');
  return { kind: 'osc', address: e.address, value: typeof first === 'number' ? first : 1, timeMs };
}

/**
 * Apply a client message to the engine (the typed reducer, plan U8). Mutations are
 * explicit and type-safe — no generic path-mutation. Project IO (`loadProject`,
 * `saveProject`, `listProjects`) is handled by the host, not here.
 */
export function applyClientMessage(engine: Engine, msg: ClientMessage, now: number): ReduceResult {
  switch (msg.t) {
    case 'midi':
      engine.applyEvent(midiToEvent(msg.note, msg.velocity, msg.on, now));
      return { structural: false, monitor: { kind: 'midi', label: `note ${msg.note}`, value: msg.velocity / 127 } };
    case 'osc':
      engine.applyEvent({ kind: 'osc', address: msg.address, value: msg.value, timeMs: now });
      return { structural: false, monitor: { kind: 'osc', label: msg.address, value: msg.value } };
    case 'setParam':
      engine.setParam(msg.layerId, msg.clipId, msg.key, msg.value);
      return { structural: false };
    case 'setLayer':
      engine.setLayerProps(msg.layerId, {
        ...(msg.blendMode !== undefined ? { blendMode: msg.blendMode } : {}),
        ...(msg.opacity !== undefined ? { opacity: msg.opacity } : {}),
        ...(msg.activeClipId !== undefined ? { activeClipId: msg.activeClipId } : {}),
        ...(msg.name !== undefined ? { name: msg.name } : {}),
      });
      return { structural: true };
    case 'addLayer':
      engine.addLayer(msg.layer);
      return { structural: true };
    case 'removeLayer':
      engine.removeLayer(msg.layerId);
      return { structural: true };
    case 'addClip':
      engine.addClip(msg.layerId, msg.clip);
      return { structural: true };
    case 'removeClip':
      engine.removeClip(msg.layerId, msg.clipId);
      return { structural: true };
    case 'setTransport':
      engine.setTransport({
        ...(msg.bpm !== undefined ? { bpm: msg.bpm } : {}),
        ...(msg.playing !== undefined ? { playing: msg.playing } : {}),
        ...(msg.beatsPerBar !== undefined ? { beatsPerBar: msg.beatsPerBar } : {}),
      });
      return { structural: true };
    case 'setKitTransform':
      engine.setKitTransform(msg.drumId, {
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
        ...(msg.rotation !== undefined ? { rotation: msg.rotation } : {}),
        ...(msg.localSpinDeg !== undefined ? { localSpinDeg: msg.localSpinDeg } : {}),
        ...(msg.startAngleDeg !== undefined ? { startAngleDeg: msg.startAngleDeg } : {}),
        ...(msg.hoopSpacingMm !== undefined ? { hoopSpacingMm: msg.hoopSpacingMm } : {}),
        ...(msg.diameterIn !== undefined ? { diameterIn: msg.diameterIn } : {}),
      });
      return { structural: true };
    case 'setOutput':
      engine.setOutput({
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
      return { structural: true };
    case 'setActiveSection':
      engine.setActiveSection(msg.songId, msg.sectionId);
      return { structural: true };
    case 'setBinding':
      engine.setBinding(msg.sectionId, msg.binding);
      return { structural: true };
    case 'removeBinding':
      engine.removeBinding(msg.sectionId, msg.drumId, msg.slot);
      return { structural: true };
    case 'addSong':
      engine.addSong(msg.song);
      return { structural: true };
    case 'removeSong':
      engine.removeSong(msg.songId);
      return { structural: true };
    case 'addSection':
      engine.addSection(msg.songId, msg.section);
      return { structural: true };
    case 'removeSection':
      engine.removeSection(msg.songId, msg.sectionId);
      return { structural: true };
    case 'setSectionLayerClip':
      engine.setSectionLayerClip(msg.sectionId, msg.layerId, msg.clipId);
      return { structural: true };
    case 'setInputMap':
      engine.setInputMap(msg.inputMap);
      return { structural: true };
    default:
      // loadProject / saveProject / listProjects are handled by the host.
      return { structural: false };
  }
}
