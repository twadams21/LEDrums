import type { PixelModel } from '@ledrums/core';
import { listEffects } from '@ledrums/core';
import type { ClientMessage, EffectSpec, ServerMessage, SerializedModel } from '@ledrums/protocol';

// The WS wire contract is defined once in `@ledrums/protocol` (app-shared, NOT pure
// `@ledrums/core`) and imported by both the server and the web client. Re-export the
// types here so the server's existing `./ws-protocol` import paths keep working; this
// module owns the server-side runtime helpers (decode/encode/serialize) below.
export type {
  ClientMessage,
  EffectSpec,
  OutputStatus,
  MonitorEvent,
  MonitorEventType,
  SerializedDrum,
  SerializedModel,
  ServerMessage,
  ShowLibraryBlob,
  SongLibraryBlob,
  TunnelInfo,
  TunnelStatus,
  VoiceStats,
} from '@ledrums/protocol';

// ---------------------------------------------------------------------------
// Client → Server (JSON)
// ---------------------------------------------------------------------------

const CLIENT_TYPES = new Set<ClientMessage['t']>([
  'midi', 'cc', 'programChange', 'osc', 'setParam', 'setLayer', 'addLayer', 'removeLayer',
  'addClip', 'removeClip', 'setTransport', 'setKitTransform', 'setKitGlobal', 'setKitOutputs', 'setOutput',
  'setActiveSection', 'setBinding', 'removeBinding', 'addSong', 'removeSong',
  'addSection', 'removeSection', 'setSectionLayerClip', 'setInputMap', 'setProject',
  'setShow', 'setShowLibrary', 'setSongLibrary', 'key', 'fireGraph', 'recallSection', 'takeover', 'tunnel',
  'loadProject', 'saveProject', 'listProjects',
  'discoverControllers', 'adoptController', 'identifyController', 'watchController',
]);

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
// The `SerializedModel`, `SerializedDrum`, `EffectSpec`, `OutputStatus`, `VoiceStats`,
// and `ServerMessage` types live in `@ledrums/protocol` (re-exported above). The
// runtime serializers that produce them follow.

export function encodeServer(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

/** Serialize the pixel model for the visualizer (sent once per connection / rebuild). */
export function serializeModel(model: PixelModel): SerializedModel {
  const positions: number[] = new Array(model.pixelCount * 3);
  const tangents: number[] = new Array(model.pixelCount * 3);
  const normals: number[] = new Array(model.pixelCount * 3);
  const segmentLengths: number[] = new Array(model.pixelCount);
  for (let i = 0; i < model.pixelCount; i++) {
    const p = model.pixels[i]!;
    positions[i * 3] = p.world.x;
    positions[i * 3 + 1] = p.world.y;
    positions[i * 3 + 2] = p.world.z;
    tangents[i * 3] = p.tangent.x;
    tangents[i * 3 + 1] = p.tangent.y;
    tangents[i * 3 + 2] = p.tangent.z;
    normals[i * 3] = p.normal.x;
    normals[i * 3 + 1] = p.normal.y;
    normals[i * 3 + 2] = p.normal.z;
    segmentLengths[i] = p.segmentLengthMm;
  }
  return {
    count: model.pixelCount,
    positions,
    tangents,
    normals,
    segmentLengths,
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
