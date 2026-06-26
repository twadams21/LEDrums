// Local TS interfaces mirroring apps/server/src/ws-protocol.ts exactly.
// Defined here because the server is a different package and its protocol module
// cannot be imported from the web app. Value constants + domain types
// (Project, Layer, Clip, etc.) come from '@ledrums/core'.
import type {
  Clip,
  EngineStats,
  InputMap,
  Layer,
  OutputConfig,
  Project,
  ParamSpec,
  Section,
  Song,
  TriggerBinding,
  voice,
} from '@ledrums/core';

// ---------------------------------------------------------------------------
// Client → Server (JSON strings via ws.send(JSON.stringify(msg)))
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'midi'; note: number; velocity: number; on: boolean }
  | { t: 'osc'; address: string; value: number }
  | {
      t: 'setParam';
      layerId: string;
      clipId: string;
      key: string;
      value: number | string | boolean;
    }
  | {
      t: 'setLayer';
      layerId: string;
      blendMode?: Layer['blendMode'];
      opacity?: number;
      activeClipId?: string | null;
      name?: string;
    }
  | { t: 'addLayer'; layer: Layer }
  | { t: 'removeLayer'; layerId: string }
  | { t: 'addClip'; layerId: string; clip: Clip }
  | { t: 'removeClip'; layerId: string; clipId: string }
  | { t: 'setTransport'; bpm?: number; playing?: boolean; beatsPerBar?: number }
  | {
      t: 'setKitTransform';
      drumId: string;
      origin?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      localSpinDeg?: number;
      startAngleDeg?: number;
      pixelsPerHoop?: number;
      hoopSpacingMm?: number;
    }
  // Reorder/replace the physical-output topology (PixLite patch order) — voice host only.
  | { t: 'setKitOutputs'; outputs: OutputConfig[] }
  | {
      t: 'setOutput';
      state?: Project['output']['state'];
      protocol?: Project['output']['protocol'];
      host?: string;
      rgbOrder?: Project['output']['rgbOrder'];
      fps?: number;
      broadcast?: boolean;
      priority?: number;
      port?: number;
      iface?: string;
    }
  | { t: 'setActiveSection'; songId: string; sectionId: string }
  | { t: 'setBinding'; sectionId: string; binding: TriggerBinding }
  | { t: 'removeBinding'; sectionId: string; drumId: string; slot: number }
  | { t: 'addSong'; song: Song }
  | { t: 'removeSong'; songId: string }
  | { t: 'addSection'; songId: string; section: Section }
  | { t: 'removeSection'; songId: string; sectionId: string }
  | { t: 'setSectionLayerClip'; sectionId: string; layerId: string; clipId: string | null }
  | { t: 'setInputMap'; inputMap: InputMap }
  // Voice-bus engine (additive, voice mode only) — keep in sync with the server.
  | { t: 'setShow'; show: voice.Show }
  | { t: 'key'; drumId: string; zone?: string; velocity?: number }
  | { t: 'recallSection'; songId: string; sectionId: string }
  | { t: 'loadProject'; name: string }
  | { t: 'saveProject'; name: string }
  | { t: 'listProjects' };

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
  /** Flat unit tangents [tx0,ty0,tz0, ...] per pixel — direction ALONG the hoop. */
  tangents: number[];
  /** Flat unit outward radial normals [nx0,ny0,nz0, ...] per pixel. */
  normals: number[];
  /** Arc length (mm) each pixel occupies along its hoop. */
  segmentLengths: number[];
  drums: SerializedDrum[];
  bounds: { center: [number, number, number]; size: number };
}

export interface EffectSpec {
  id: string;
  name: string;
  category: string;
  paramSpec: ParamSpec[];
}

export interface OutputStatus {
  state: Project['output']['state'];
  protocol: Project['output']['protocol'];
  host: string;
  packetsSent: number;
  lastError: string | null;
  /** Universe count, when the server reports it. */
  universeCount?: number;
}

/** Optional voice-bus telemetry, present only when the server runs the voice engine. */
export interface VoiceStats {
  voiceCount: number;
  busLevels: Record<string, number>;
}

export type ServerMessage =
  | {
      t: 'state';
      project: Project;
      model: SerializedModel;
      effects: EffectSpec[];
      projects: string[];
      output: OutputStatus;
    }
  | { t: 'stats'; stats: EngineStats; latencyMs: number; fps: number; output: OutputStatus; voice?: VoiceStats }
  | { t: 'input'; kind: 'midi' | 'osc'; label: string; value: number }
  | { t: 'projects'; names: string[] }
  | { t: 'error'; message: string };

const SERVER_TYPES = new Set<ServerMessage['t']>([
  'state',
  'stats',
  'input',
  'projects',
  'error',
]);

/** Parse a text WS payload into a typed ServerMessage, or null if malformed/unknown. */
export function decodeServer(raw: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !obj ||
    typeof obj !== 'object' ||
    typeof (obj as { t?: unknown }).t !== 'string' ||
    !SERVER_TYPES.has((obj as { t: ServerMessage['t'] }).t)
  ) {
    return null;
  }
  return obj as ServerMessage;
}
