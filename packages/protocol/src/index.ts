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
  ProjectPatch,
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
  | { t: 'setKitTransform'; drumId: string; origin?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; localSpinDeg?: number; startAngleDeg?: number; pixelsPerHoop?: number; hoopSpacingMm?: number; diameterIn?: number; flip?: boolean }
  // Kit-global geometry (S11): mirror is not per-drum, so it rides its own message rather than
  // setKitTransform's drum carrier. Both hosts rebuild the model (not just dmxMap) on apply.
  | { t: 'setKitGlobal'; mirror?: 'none' | 'x' | 'y' }
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
  // Bulk device re-rig (group K / S45): paste a `patch` ClipDoc's Project slices (kit incl.
  // outputs, input map, output settings) as ONE message. The server schema-validates the whole
  // payload BEFORE touching any state, applies it once (a single kit reload — NOT a replay of
  // granular setKit*/setOutput/setInputMap messages), persists, and broadcasts fresh `state`.
  // An invalid payload is rejected with an `error` reply and zero partial apply. Never merges
  // authored composition/setlist — it re-rigs only the physical device.
  | { t: 'setProject'; patch: ProjectPatch }
  // Voice-bus engine (additive, voice mode only): replace the authored Show.
  | { t: 'setShow'; show: voice.Show }
  // Server-authoritative show library: the client pushes the authored library (an opaque
  // versioned blob — its schema is web-owned) on every authored change; the server persists
  // it and rebroadcasts it on cold load via the `state` message. Mode-independent.
  | { t: 'setShowLibrary'; library: ShowLibraryBlob }
  // Server-authoritative SONG library (the canonical songs shows import). Same contract as
  // `setShowLibrary`: the client pushes an opaque versioned blob on every library change; the
  // server persists it as a second named blob and rebroadcasts it on cold load / live.
  | { t: 'setSongLibrary'; library: SongLibraryBlob }
  | { t: 'key'; drumId: string; zone?: string; velocity?: number }
  // Keyboard performance intent (voice mode): play an EXACT authored graph by key. Sent
  // instead of a synthetic MIDI/OSC source so the server fires precisely that graph, with no
  // zone-map / direct-binding re-resolution (which could otherwise both-fire). `velocity` is
  // 0..1. The server validates the key and emits the normal graph diagnostics.
  | { t: 'fireGraph'; graphKey: string; velocity: number }
  | { t: 'recallSection'; songId: string; sectionId: string }
  // Multi-client takeover (S2): any client may claim the single editor slot. The server hands it
  // the slot, drops the prior editor to viewer, and re-broadcasts `presence` so every client's
  // role converges (last-press-wins for near-simultaneous takeovers). Carries no payload — the
  // sender IS the claimant.
  | { t: 'takeover' }
  // Remote-access lifecycle control (S3 follow-up): start/stop the outbound share tunnel from
  // the app. Editor-only (deny-by-default gate) AND refused for clients that arrived VIA the
  // tunnel — a remote viewer must never kill or restart the tunnel it rode in on. The server
  // reports progress via `TunnelInfo.status` on the `state` message.
  | { t: 'tunnel'; action: 'start' | 'stop' }
  | { t: 'loadProject'; name: string }
  | { t: 'saveProject'; name: string }
  | { t: 'listProjects' }
  // --- PixLite controller monitor (S47, group L) -----------------------------
  // Trigger a one-shot discovery sweep of the candidate subnet(s) derived from the configured
  // output host/interface (falling back to local NIC subnets). The server replies with a single
  // `controllerDiscovery` message carrying the ranked candidate list. Editor-gated (a viewer's
  // panel can watch live status but not initiate network sweeps or re-rig the device).
  | { t: 'discoverControllers' }
  // Adopt `host` as THE controller for this project: the server probes it, persists
  // `{ host, nickname }` on the Project (rehydrated across restarts), and begins reporting its
  // live status via `controllerStatus`. Editor-gated. A host that doesn't answer as a PixLite is
  // reported back as an `error` (no adoption).
  | { t: 'adoptController'; host: string }
  // Flash the adopted controller's status LED for `durationS` seconds (0 = off, 121 = continuous)
  // — the "which box is this?" confirmation. Editor-gated. No-op when nothing is adopted.
  | { t: 'identifyController'; durationS: number }
  // Drive the controller's built-in test-data mode (S49): a solid colour / RGBW cycle / colour
  // fade, per-port or per-pixel. While this runs the controller IGNORES the live Art-Net stream
  // (a LOUD takeover state) — the server reports it back on `ControllerStatus.testPattern`.
  // Editor-gated. No-op when nothing is adopted.
  | { t: 'controllerTestData'; pattern: ControllerTestPattern }
  // Return the adopted controller to LIVE mode — the "back to live data" exit from a test pattern.
  // Editor-gated. No-op when nothing is adopted / not in test mode. The server also fires this
  // automatically when the last panel watcher leaves (panel close / disconnect) so a controller is
  // never stranded in test mode.
  | { t: 'controllerBackToLive' }
  // Client interest signal — the ONLY thing that gates the poll loop (no idle traffic). A client
  // sends `watching: true` while it has the Monitor/Patch controller panel open and `false` when it
  // closes it; a disconnect implicitly clears it. The server polls `statisticRead` at 1–2s only
  // while ≥1 client is watching AND a controller is adopted. NOT editor-gated — a viewer watching
  // the panel keeps live status flowing for everyone.
  | { t: 'watchController'; watching: boolean };

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

/** The authored SONG library on the wire — a sibling of {@link ShowLibraryBlob} one layer up
    (canonical songs a show imports). Same contract: an opaque, web-owned versioned envelope the
    server persists verbatim (as a second named blob) and rebroadcasts; the web validates it via
    `deserializeSongLibrary` on adopt. */
export interface SongLibraryBlob {
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

/** One live voice, streamed so a CONNECTED client's Layers/Buses dock renders the voices the
 * server engine is actually sounding — not the offline sim's (S17). Only the fields the dock chip
 * draws travel the wire; the engine's internal {@link voice.Voice} (pattern / envelope / generator
 * state) stays server-side. */
export interface VoiceStat {
  /** Stable voice identity — the dock keys chips on it. */
  id: string;
  busId: string;
  effectId: string;
  mode: voice.PlayMode;
  /** Combined `level * deckGain`, 0..1 — drives the chip's brightness. */
  level: number;
  /** Param hue for the chip colour (0 when the effect exposes none). */
  hue: number;
  /** True while the voice is fading out (release phase) — the chip dims. */
  releasing: boolean;
  /** Provenance label (the voice's `via`) — shown as the chip tooltip. */
  via: string;
}

/** Optional voice-bus telemetry, present only when the server runs the voice engine. */
export interface VoiceStats {
  voiceCount: number;
  busLevels: Record<string, number>;
  /** Per-voice detail for the Layers/Buses dock (S17) — empty when nothing sounds. */
  voices: VoiceStat[];
}

// ---------------------------------------------------------------------------
// PixLite controller monitor (S47, group L) — the confidence chain's last link:
// controller received → controller outputting. The server owns a controller-monitor service
// (discovery + adoption + polling); these are the wire shapes it emits. The S48 panel renders
// them directly.
// ---------------------------------------------------------------------------

/** One universe's receive verification, flattened from the controller's parallel sACN/Art-Net
 * arrays into a single list the panel renders row-by-row. `receiving` is the headline signal —
 * it is the controller's `timedOut === false`, i.e. valid data is arriving on this universe RIGHT
 * NOW. A `receiving: false` row is the "not receiving" state the panel must make unmissable. */
export interface ControllerUniverseRx {
  /** DMX universe number. */
  uniNum: number;
  /** Which protocol this universe was read from. */
  protocol: 'sACN' | 'artNet';
  /** true = valid data arriving on this universe now (controller's `!timedOut`). */
  receiving: boolean;
  /** Good packets received. */
  inGood: number;
  /** Out-of-sequence packets (dropped). */
  inBadSeq: number;
  /** Packets dropped for lower-than-active priority (sACN only). */
  inLowPri?: number;
  /** Currently active priority 0–200 (sACN only). */
  priority?: number;
  /** Source description, e.g. `"Your Lighting Software"` (sACN only). */
  sourceName?: string;
}

/** A candidate found by a discovery sweep — identity only (no live stats until adopted). The panel
 * lists these best-first (higher `score` = more likely the PixLite you want) and offers Adopt on each. */
export interface DiscoveredController {
  /** The responder's IP (what `adoptController` takes). */
  host: string;
  /** Product/model string, e.g. `"PixLite A16-S Mk3"`. */
  prodName: string;
  /** User-assigned label on the device, e.g. `"Roof Left 1"`. */
  nickname: string;
  /** Firmware version, e.g. `"1.2.3"`. */
  fwVer: string;
  /** True if the device requires an admin password for management calls. */
  authReqd: boolean;
  /** Discovery rank — higher sorts first (PixLite/Advatek-branded above generic responders). */
  score: number;
}

/** A built-in controller test pattern (S49) — the wire mirror of the io `ModeTestDataParams`
 * (§7.7.2). The web sends it in `controllerTestData`; the server maps it onto the PixLite client and
 * echoes the active one back on {@link ControllerStatus.testPattern} so every watcher sees the loud
 * takeover state. `op` picks the pattern; `color` (RGBW) only matters for `setColor`; `pixPortNum` /
 * `pixNum` target a port / pixel (0 = all). */
export interface ControllerTestPattern {
  op: 'setColor' | 'rgbwCycle' | 'colorFade';
  /** RGBW colour for `setColor`, each 0–255 at 8-bit resolution. */
  color?: [number, number, number, number];
  /** Colour-array resolution. Defaults to 8-bit on the device when omitted. */
  colorRes?: '8Bit' | '16Bit';
  /** Pixel port to test (1-based), or 0 for all ports. */
  pixPortNum?: number;
  /** Pixel to test (1-based), or 0 for all pixels. */
  pixNum?: number;
}

/** Live status of the ADOPTED controller — the payload of the `controllerStatus` message and the
 * single source the S48 panel renders. Emitted on adopt, on every successful poll, and on a failed
 * poll (with `reachable: false` and a frozen `lastSeen`). Identity is null only in the brief window
 * before the first probe resolves. */
export interface ControllerStatus {
  /** The adopted controller's host (IP) — stable identity the panel keys on. */
  host: string;
  /** Whether the most recent contact succeeded. false = a poll timed out/errored (controller lost);
   * the panel shows the lost state and `lastSeen` stops advancing (ages). */
  reachable: boolean;
  /** Identity (name/model/firmware/IP) from the `/ver` probe. `nickname` is the display name,
   * `prodName` the model, `fwVer` the firmware, `host` the IP. null until the first probe resolves. */
  identity: { host: string; prodName: string; nickname: string; fwVer: string; authReqd: boolean } | null;
  /** Per-universe rx verification (sACN + Art-Net flattened), empty until the first stats poll. */
  universes: ControllerUniverseRx[];
  /** Detected input frame rate (Hz) and pixel output frame rate (Hz). */
  rates: { inFrmRate?: number; outFrmRate?: number };
  /** Device health: temperature, per-bank input voltage, per-port power status, per-port eth link. */
  health: { tempC?: number; bankVoltsMv?: number[]; portStatus?: string[]; ethLinkUp?: boolean[] };
  /** Epoch ms of the last SUCCESSFUL contact, or null if never reached. Frozen while unreachable —
   * `Date.now() - lastSeen` is how long the controller has been quiet. */
  lastSeen: number | null;
  /** Active built-in test pattern (S49), or null/absent when the controller is in normal LIVE mode.
   * Non-null = the LOUD takeover state: the box is running synthetic data and IGNORING the live
   * Art-Net stream. Server-authoritative so every watcher's banner + output pill agree. */
  testPattern?: ControllerTestPattern | null;
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

/** Tunnel lifecycle phase, driven by the server's tunnel control (in-app start/stop). */
export type TunnelStatus = 'off' | 'starting' | 'live' | 'error';

/** Remote-access surface (S3): the share-tunnel lifecycle state, the public URL of the outbound
 * Cloudflare tunnel and the room PIN, so an authenticated client's UI can display "scan/visit
 * this URL, enter this PIN" — and offer Start/Stop sharing. Carried on the `state` message (only
 * ever sent to already-admitted clients), so an un-authed connection — refused before any
 * `state` — never learns the PIN. Always present on `state` (the Share button is always shown);
 * `status: 'off'` + null fields is plain un-shared local dev. */
export interface TunnelInfo {
  /** Lifecycle phase of the share tunnel. */
  status: TunnelStatus;
  /** Resolved public URL (e.g. `https://foo.trycloudflare.com`), or null when no tunnel runs. */
  url: string | null;
  /** Active room PIN, or null when the server is open (no PIN gate). */
  pin: string | null;
  /** Plain-language failure description, present only when `status === 'error'`. */
  error?: string;
}

export type ServerMessage =
  // `showLibrary` carries the server's persisted authored show library (the opaque versioned
  // blob), or null when the server has none yet — the web adopts it on cold load.
  // `tunnel` carries the remote-access surface (share URL + room PIN) for the host UI; null when
  // neither a tunnel nor a PIN gate is configured (plain local dev). See {@link TunnelInfo}.
  // `songLibrary` carries the server's persisted authored SONG library (a second opaque versioned
  // blob), or null when the server has none yet — adopted on cold load like `showLibrary`.
  | { t: 'state'; project: Project; model: SerializedModel; effects: EffectSpec[]; projects: string[]; output: OutputStatus; showLibrary: ShowLibraryBlob | null; songLibrary: SongLibraryBlob | null; tunnel: TunnelInfo | null }
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
  // Live SONG-library push: the editor's `setSongLibrary` relayed to the OTHER clients, mirroring
  // the `showLibrary` relay. Never echoed to the sender.
  | { t: 'songLibrary'; library: SongLibraryBlob }
  // Result of a `discoverControllers` sweep: the ranked candidate list (best-first). Replaces the
  // panel's candidate list wholesale each time — an empty array means "sweep finished, found none".
  | { t: 'controllerDiscovery'; candidates: DiscoveredController[] }
  // Live status of the adopted controller (S47). Emitted on adopt, on each successful poll, and on a
  // failed poll (`reachable: false`, frozen `lastSeen`). The S48 panel renders {@link ControllerStatus}
  // directly. `status` is null when no controller is adopted (e.g. right after a project with no
  // controller loads) — the panel then shows the un-adopted "Discover" affordance.
  | { t: 'controllerStatus'; status: ControllerStatus | null }
  | { t: 'error'; message: string };
