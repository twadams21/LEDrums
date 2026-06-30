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
// Transport-level constants
// ---------------------------------------------------------------------------

/** WS close code used when a connection is refused for an absent/incorrect room PIN
 * (S3 remote-access gate). In the application-private 4000–4999 range; chosen to echo
 * HTTP 401 Unauthorized. The web client treats this code specially: it stops the
 * auto-reconnect loop and prompts for a PIN instead of dialing forever. */
export const WS_CLOSE_INVALID_PIN = 4401;

// ---------------------------------------------------------------------------
// Client → Server (JSON strings via ws.send(JSON.stringify(msg)))
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'midi'; note: number; velocity: number; on: boolean; channel?: number }
  // Global transport recall (voice mode): a Control Change (cc) and a Program Change.
  // The server's global recall handler intercepts cc#0 + programChange BEFORE the
  // per-trigger zone-map; other controllers are currently no-ops.
  | { t: 'cc'; controller: number; value: number; channel?: number }
  | { t: 'programChange'; value: number; channel?: number }
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
  // Multi-client takeover (S2): any client may claim the single editor slot. The server hands it
  // the slot, drops the prior editor to viewer, and re-broadcasts `presence` so every client's
  // role converges (last-press-wins for near-simultaneous takeovers). Carries no payload — the
  // sender IS the claimant.
  | { t: 'takeover' }
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

export type MonitorEventType = 'input' | 'output' | 'effect' | 'graph' | 'system' | 'persistence' | 'error';

export interface MonitorEvent {
  id: number;
  time: number;
  type: MonitorEventType;
  direction: 'in' | 'out' | 'local';
  source: string;
  destination?: string;
  label: string;
  detail?: string;
}

/** Remote-access surface (S3): the public share URL of the outbound Cloudflare tunnel and the
 * room PIN, so an authenticated client's UI can display "scan/visit this URL, enter this PIN".
 * Carried on the `state` message (only ever sent to already-admitted clients), so an un-authed
 * connection — refused before any `state` — never learns either. A field is null when that
 * facility is disabled: `url` null = no tunnel running; `pin` null = no PIN gate (open server). */
export interface TunnelInfo {
  /** Resolved public URL (e.g. `https://foo.trycloudflare.com`), or null when no tunnel runs. */
  url: string | null;
  /** Active room PIN, or null when the server is open (no PIN gate). */
  pin: string | null;
}

export type ServerMessage =
  // `showLibrary` carries the server's persisted authored show library (the opaque versioned
  // blob), or null when the server has none yet — the web adopts it on cold load.
  // `tunnel` carries the remote-access surface (share URL + room PIN) for the host UI; null when
  // neither a tunnel nor a PIN gate is configured (plain local dev). See {@link TunnelInfo}.
  | { t: 'state'; project: Project; model: SerializedModel; effects: EffectSpec[]; projects: string[]; output: OutputStatus; showLibrary: ShowLibraryBlob | null; tunnel: TunnelInfo | null }
  | { t: 'stats'; stats: EngineStats; latencyMs: number; fps: number; output: OutputStatus; voice?: VoiceStats }
  | { t: 'input'; kind: 'midi' | 'osc'; label: string; value: number; note?: number; channel?: number }
  | { t: 'monitor'; event: MonitorEvent }
  | { t: 'projects'; names: string[] }
  // Multi-client presence (S1): who is the single editor, whether THIS recipient is it, and how
  // many clients are connected. Sent to a client on join and re-broadcast to every client on any
  // join/leave (each recipient gets its own `youAreEditor`). `editorId` is null when no client
  // currently holds the editor slot (the editor left with ≥2 viewers remaining — S2 takeover).
  | { t: 'presence'; editorId: string | null; youAreEditor: boolean; clientCount: number }
  // Live authored-library push (S1): the editor's `setShowLibrary` relayed to the OTHER clients so
  // viewers live-follow without a full `state` rebuild. Never echoed back to the editor that sent
  // it. Carries the same opaque versioned blob the server persists + ships on `state`.
  | { t: 'showLibrary'; library: ShowLibraryBlob }
  | { t: 'error'; message: string };
