import { listEffects } from '@ledrums/core';
import { clientMessageSchema, clientMessageTypes } from '@ledrums/protocol';
import type { ClientMessage, EffectSpec, ServerMessage } from '@ledrums/protocol';

// Preserve callers while sharing the exact serializer with the offline web preview.
export { serializePixelModel as serializeModel } from '@ledrums/protocol';

// The WS wire contract is defined once in `@ledrums/protocol` (app-shared, NOT pure
// `@ledrums/core`) and imported by both the server and the web client. Re-export the
// types here so the server's existing `./ws-protocol` import paths keep working; this
// module owns the server-side runtime helpers (decode/encode/serialize) below.
export type {
  BackupReason,
  BackupSnapshotMeta,
  ClientMessage,
  ControllerStatus,
  ControllerTestPattern,
  ControllerUniverseRx,
  DiscoveredController,
  EffectSpec,
  NetworkAdapter,
  OscListenInfo,
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

/**
 * Parse a text WS frame into a validated `ClientMessage`, or THROW. The single-source runtime
 * schema (`clientMessageSchema` in `@ledrums/protocol`) both narrows `t` and validates every
 * payload field, so a malformed message never reaches a handler. Callers (`main.ts`,
 * `http/native-midi.ts`) wrap this in try/catch and surface the throw as an `error` reply / 400,
 * so the throw-on-invalid contract is preserved. An unrecognised `t` keeps its original
 * "Unknown client message type" message (the known set is DERIVED from the schema).
 */
export function decodeClient(raw: string): ClientMessage {
  const obj: unknown = JSON.parse(raw);
  const t = (obj as { t?: unknown } | null)?.t;
  if (typeof t !== 'string' || !clientMessageTypes.has(t)) {
    throw new Error(`Unknown client message type: ${typeof t === 'string' ? t : String(t)}`);
  }
  const result = clientMessageSchema.safeParse(obj);
  if (!result.success) {
    throw new Error(`Invalid ${t} message: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return result.data;
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
