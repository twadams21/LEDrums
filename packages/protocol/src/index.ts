// @ledrums/protocol — the WebSocket wire contract shared by apps/server and apps/web.
//
// This is the SINGLE SOURCE OF TRUTH for the messages exchanged over the WS link.
// It is an APP-LEVEL package (NOT pure `@ledrums/core`): it depends on core for the
// domain types the messages carry (Project, Layer, Clip, …), but it models the
// app/transport boundary, which core must never know about. The server's
// `ws-protocol.ts` and the web's `lib/ws/protocol-types.ts` both re-export these
// types and add their own runtime (de)serialization helpers on top.
import type { ParamSpec, Project, voice } from '@ledrums/core';

// The runtime wire schemas (and the `ClientMessage`/`ServerMessage` types inferred from them) are
// the single source of truth for the message contract; they live in `./schemas` and are re-exported
// here so `@ledrums/protocol` stays the one import path. The payload interfaces below (SerializedModel,
// EffectSpec, OutputStatus, …) are locked to their schemas by a type-level assertion in `./schemas`.
export {
  clientMessageSchema,
  clientMessageTypes,
  serverMessageSchema,
  showLibraryBlobSchema,
  showSchema,
  songLibraryBlobSchema,
} from './schemas';
export type { ClientMessage, ServerMessage } from './schemas';

// ---------------------------------------------------------------------------
// Transport-level constants
// ---------------------------------------------------------------------------

/** WS close code used when a connection is refused for an absent/incorrect room PIN
 * (S3 remote-access gate). In the application-private 4000–4999 range; chosen to echo
 * HTTP 401 Unauthorized. The web client treats this code specially: it stops the
 * auto-reconnect loop and prompts for a PIN instead of dialing forever. */
export const WS_CLOSE_INVALID_PIN = 4401;


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

/** Why a backup snapshot was taken (#123) — mirrors the server SnapshotStore's `SnapshotReason`.
 * The Backups dialog renders it beside the relative time so the drummer can find "the state before
 * it broke": `boot` (session start), `cadence` (periodic), `pre-risk` (just before a risky op). */
export type BackupReason = 'boot' | 'cadence' | 'pre-risk';

/** One local snapshot as listed to the client (#123): identity + when + why. The full bundle stays
 * server-side; the dialog lists these and restores one by `id`. Newest-first on the wire. */
export interface BackupSnapshotMeta {
  /** Stable snapshot id (`<createdAt>-<reason>`) — what `restoreBackup` takes. */
  id: string;
  /** Epoch ms the snapshot was taken — the dialog renders it as a relative time. */
  createdAt: number;
  reason: BackupReason;
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

/** A network adapter (NIC) on the SERVER machine, enumerated so the app can tell the operator which
 * subnet the PixLite must join and recommend a concrete static IP for it. The server computes
 * `recommendedIp` (a free-ish host in this adapter's subnet, avoiding the PC's own address) so the
 * web is a pure renderer. Only non-internal IPv4 adapters that have an address are listed. */
export interface NetworkAdapter {
  /** OS adapter name, e.g. `"Ethernet"` / `"en0"`. */
  name: string;
  /** The PC's IPv4 address on this adapter, e.g. `"192.168.1.10"`. */
  address: string;
  /** Dotted-decimal subnet mask, e.g. `"255.255.255.0"`. */
  netmask: string;
  /** CIDR of the PC's own address, e.g. `"192.168.1.10/24"`. */
  cidr: string;
  /** Network CIDR — the subnet to sweep / that the controller must join, e.g. `"192.168.1.0/24"`. */
  subnet: string;
  /** Suggested static IP for the controller in this subnet: in-range, not the PC's own address, and
   * avoiding the network/broadcast/`.1` gateway addresses. */
  recommendedIp: string;
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

