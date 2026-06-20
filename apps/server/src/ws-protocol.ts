import type {
  Clip,
  EngineStats,
  Layer,
  PixelModel,
  Project,
} from '@ledrums/core';
import { listEffects } from '@ledrums/core';

// ---------------------------------------------------------------------------
// Client → Server (JSON)
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'midi'; note: number; velocity: number; on: boolean }
  | { t: 'osc'; address: string; value: number }
  | { t: 'setParam'; layerId: string; clipId: string; key: string; value: number | string | boolean }
  | { t: 'setLayer'; layerId: string; blendMode?: Layer['blendMode']; opacity?: number; activeClipId?: string | null; name?: string }
  | { t: 'addLayer'; layer: Layer }
  | { t: 'removeLayer'; layerId: string }
  | { t: 'addClip'; layerId: string; clip: Clip }
  | { t: 'removeClip'; layerId: string; clipId: string }
  | { t: 'setTransport'; bpm?: number; playing?: boolean; beatsPerBar?: number }
  | { t: 'setKitTransform'; drumId: string; origin?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; localSpinDeg?: number; startAngleDeg?: number }
  | { t: 'setOutput'; state?: Project['output']['state']; protocol?: Project['output']['protocol']; host?: string; rgbOrder?: Project['output']['rgbOrder']; fps?: number; broadcast?: boolean }
  | { t: 'loadProject'; name: string }
  | { t: 'saveProject'; name: string }
  | { t: 'listProjects' };

const CLIENT_TYPES = new Set<ClientMessage['t']>([
  'midi', 'osc', 'setParam', 'setLayer', 'addLayer', 'removeLayer',
  'addClip', 'removeClip', 'setTransport', 'setKitTransform', 'setOutput',
  'loadProject', 'saveProject', 'listProjects',
]);

export function encodeClient(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage {
  const obj = JSON.parse(raw);
  if (!obj || typeof obj.t !== 'string' || !CLIENT_TYPES.has(obj.t)) {
    throw new Error(`Unknown client message type: ${obj?.t}`);
  }
  return obj as ClientMessage;
}

// ---------------------------------------------------------------------------
// Server → Client (JSON, plus a separate binary frame channel)
// ---------------------------------------------------------------------------

export interface SerializedDrum {
  id: string;
  label: string;
  color: string;
  pixelStart: number;
  pixelCount: number;
}

export interface SerializedModel {
  count: number;
  /** Flat world positions [x0,y0,z0, x1,y1,z1, ...], mm. */
  positions: number[];
  drums: SerializedDrum[];
  bounds: { center: [number, number, number]; size: number };
}

export interface EffectSpec {
  id: string;
  name: string;
  category: string;
  paramSpec: ReturnType<typeof listEffects>[number]['paramSpec'];
}

export type ServerMessage =
  | { t: 'state'; project: Project; model: SerializedModel; effects: EffectSpec[]; projects: string[]; output: OutputStatus }
  | { t: 'stats'; stats: EngineStats; latencyMs: number; fps: number; output: OutputStatus }
  | { t: 'input'; kind: 'midi' | 'osc'; label: string; value: number }
  | { t: 'projects'; names: string[] }
  | { t: 'error'; message: string };

export interface OutputStatus {
  state: Project['output']['state'];
  protocol: Project['output']['protocol'];
  host: string;
  packetsSent: number;
  lastError: string | null;
  /** Number of DMX universes the current topology transmits. */
  universeCount: number;
}

export function encodeServer(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

/** Serialize the pixel model for the visualizer (sent once per connection / rebuild). */
export function serializeModel(model: PixelModel): SerializedModel {
  const positions: number[] = new Array(model.pixelCount * 3);
  for (let i = 0; i < model.pixelCount; i++) {
    const p = model.pixels[i]!;
    positions[i * 3] = p.world.x;
    positions[i * 3 + 1] = p.world.y;
    positions[i * 3 + 2] = p.world.z;
  }
  return {
    count: model.pixelCount,
    positions,
    drums: model.drums.map((d) => ({ id: d.drumId, label: d.label, color: d.color, pixelStart: d.pixelStart, pixelCount: d.pixelCount })),
    bounds: { center: [model.bounds.center.x, model.bounds.center.y, model.bounds.center.z], size: model.bounds.size },
  };
}

export function effectSpecs(): EffectSpec[] {
  return listEffects().map((e) => ({ id: e.id, name: e.name, category: e.category, paramSpec: e.paramSpec }));
}

/** Quantize a frame to RGB bytes for the wire (visualizer instance colors). */
export function frameToRgbBytes(rgba: Float32Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const j = i * 4;
    out[i * 3] = Math.round(Math.min(1, Math.max(0, rgba[j]!)) * 255);
    out[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, rgba[j + 1]!)) * 255);
    out[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, rgba[j + 2]!)) * 255);
  }
  return out;
}
