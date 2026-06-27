// @ledrums/protocol — the WebSocket wire contract shared by apps/server and apps/web.
//
// This is the SINGLE SOURCE OF TRUTH for the messages exchanged over the WS link.
// It is an APP-LEVEL package (NOT pure `@ledrums/core`): it depends on core for the
// domain types the messages carry (Project, Layer, Clip, …), but it models the
// app/transport boundary, which core must never know about. The server's
// `ws-protocol.ts` and the web's `lib/ws/protocol-types.ts` both re-export these
// types and add their own runtime (de)serialization helpers on top.
import type {
  Clip,
  EngineStats,
  InputMap,
  Layer,
  OutputConfig,
  ParamSpec,
  Project,
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
  // Global transport recall (voice mode): a Control Change (cc) and a Program Change.
  // The server's global recall handler intercepts cc#0 + programChange BEFORE the
  // per-trigger zone-map; other controllers are currently no-ops.
  | { t: 'cc'; controller: number; value: number }
  | { t: 'programChange'; value: number }
  | { t: 'osc'; address: string; value: number }
  | { t: 'setParam'; layerId: string; clipId: string; key: string; value: number | string | boolean }
  | { t: 'setLayer'; layerId: string; blendMode?: Layer['blendMode']; opacity?: number; activeClipId?: string | null; name?: string }
  | { t: 'addLayer'; layer: Layer }
  | { t: 'removeLayer'; layerId: string }
  | { t: 'addClip'; layerId: string; clip: Clip }
  | { t: 'removeClip'; layerId: string; clipId: string }
  | { t: 'setTransport'; bpm?: number; playing?: boolean; beatsPerBar?: number }
  | { t: 'setKitTransform'; drumId: string; origin?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; localSpinDeg?: number; startAngleDeg?: number; pixelsPerHoop?: number; hoopSpacingMm?: number; diameterIn?: number }
  // Reorder/replace the physical-output topology (PixLite patch order) — voice host only.
  | { t: 'setKitOutputs'; outputs: OutputConfig[] }
  | { t: 'setOutput'; state?: Project['output']['state']; protocol?: Project['output']['protocol']; host?: string; rgbOrder?: Project['output']['rgbOrder']; fps?: number; broadcast?: boolean; priority?: number; port?: number; iface?: string }
  // Setlist / songs / sections / per-trigger routing
  | { t: 'setActiveSection'; songId: string; sectionId: string }
  | { t: 'setBinding'; sectionId: string; binding: TriggerBinding }
  | { t: 'removeBinding'; sectionId: string; drumId: string; slot: number }
  | { t: 'addSong'; song: Song }
  | { t: 'removeSong'; songId: string }
  | { t: 'addSection'; songId: string; section: Section }
  | { t: 'removeSection'; songId: string; sectionId: string }
  | { t: 'setSectionLayerClip'; sectionId: string; layerId: string; clipId: string | null }
  | { t: 'setInputMap'; inputMap: InputMap }
  // Voice-bus engine (additive, voice mode only): replace the authored Show.
  | { t: 'setShow'; show: voice.Show }
  // Server-authoritative show library: the client pushes the authored library (an opaque
  // versioned blob — its schema is web-owned) on every authored change; the server persists
  // it and rebroadcasts it on cold load via the `state` message. Mode-independent.
  | { t: 'setShowLibrary'; library: ShowLibraryBlob }
  | { t: 'key'; drumId: string; zone?: string; velocity?: number }
  | { t: 'recallSection'; songId: string; sectionId: string }
  | { t: 'loadProject'; name: string }
  | { t: 'saveProject'; name: string }
  | { t: 'listProjects' };

// ---------------------------------------------------------------------------
// Server → Client (JSON, plus a separate binary frame channel)
// ---------------------------------------------------------------------------

/** The authored show library on the wire: the server stores + rebroadcasts it as an opaque
    versioned blob. Its schema (the web's `PersistedShowLibrary` envelope) is WEB-OWNED — the
    server persists `data` verbatim and never interprets it; the web validates it via
    `deserializeShowLibrary` on adopt. Mirrors the web's persistence envelope: a `version` gate
    plus the bare library under `data`. */
export interface ShowLibraryBlob {
  version: number;
  data: unknown;
}

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
  /** The effect's parameter declarations (core's `ParamSpec`) — the wire shape of
      `EffectGenerator.paramSpec`, used by the UI to render controls generically. */
  paramSpec: ParamSpec[];
}

export interface OutputStatus {
  state: Project['output']['state'];
  protocol: Project['output']['protocol'];
  host: string;
  packetsSent: number;
  lastError: string | null;
  /** Number of DMX universes the current topology transmits. The server always sets this
      (see OutputManager.status), so it is required on the wire. */
  universeCount: number;
}

/** Optional voice-bus telemetry, present only when the server runs the voice engine. */
export interface VoiceStats {
  voiceCount: number;
  busLevels: Record<string, number>;
}

export type ServerMessage =
  // `showLibrary` carries the server's persisted authored show library (the opaque versioned
  // blob), or null when the server has none yet — the web adopts it on cold load.
  | { t: 'state'; project: Project; model: SerializedModel; effects: EffectSpec[]; projects: string[]; output: OutputStatus; showLibrary: ShowLibraryBlob | null }
  | { t: 'stats'; stats: EngineStats; latencyMs: number; fps: number; output: OutputStatus; voice?: VoiceStats }
  | { t: 'input'; kind: 'midi' | 'osc'; label: string; value: number }
  | { t: 'projects'; names: string[] }
  | { t: 'error'; message: string };
