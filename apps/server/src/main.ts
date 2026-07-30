import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { hostname, platform, release } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  defaultProject,
  parseProject,
  reconcileOutputs,
  WS_PATH,
  WS_PORT,
  type Project,
} from '@ledrums/core';
import { HttpPixliteClient, OscInput, OSC_DEFAULT_PORT, probe as probeController } from '@ledrums/io';
import { WebSocketServer, type WebSocket } from 'ws';
import { EngineHost } from './engine-host';
import { resolveEngineMode } from './engine-mode';
import { VoiceEngineHost } from './voice-engine-host';
import {
  oscToEvent,
  oscRecall,
  parseSectionRecallAddress,
} from './input-router';
import { listProjects, resolveProjectsDir, saveProjectAsync } from './projects';
import { resolveInitialProject } from './boot-project';
import { inspectShowLibraryFile, loadShowLibrary, saveShowLibraryAsync, type ShowLibraryBlob } from './show-library';
import { inspectSongLibraryFile, loadSongLibrary, saveSongLibraryAsync, type SongLibraryBlob } from './song-library';
import { createAutosaver } from './autosave';
import { createPersistedSlot } from './persisted-slot';
import { buildStatsMessage, STATS_INTERVAL_MS } from './stats-frame';
import { ClientRegistry } from './client-registry';
import { serveStatic, resolveWebRoot } from './static-host';
import { TunnelManager, tunnelConfigFromEnv } from './tunnel-manager';
import { TunnelControl } from './tunnel-control';
import { createMutablePinGate, resolveHostToken, resolvePin } from './pin-gate';
import { boot, lanAddresses } from './boot';
import { createControllerMonitor } from './controller-monitor';
import { listNetworkAdapters } from './network-adapters';
import { createClientMessageHandler } from './handlers/client-message';
import { createNativeMidiHandler } from './http/native-midi';
import { createHostEventHandler } from './http/host-event';
import { createUpdateStatusHandler } from './http/update-status';
import { applyTransportRecall } from './handlers/voice-input';
import { startupDiagnostics } from './diagnostics';
import { createMonitorBus } from './monitor';
import { installProcessErrorCapture } from './process-errors';
import { createFatalHandler } from './fatal-shutdown';
import { createBroadcaster } from './ws-broadcast';
import { createWsConnectionHandler } from './ws-connection';
import { createShipQueue, type ShipQueue } from './telemetry/ship-queue';
import { createHttpTransport } from './telemetry/transport';
import { createReporter, type Reporter } from './telemetry/reporter';
import { isTelemetryEnabled, type ReportRecord } from './telemetry/envelope';
import { createSnapshotStore, type SnapshotFiles, type SnapshotStore } from './backups/snapshot-store';
import { backupsEndpoint, toBackupRecord, type BackupRecord } from './backups/offsite';
import {
  effectSpecs,
  encodeServer,
  serializeModel,
  type ClientMessage,
  type OscListenInfo,
  type ServerMessage,
  type TunnelInfo,
} from './ws-protocol';

const port = Number(process.env.PORT) || WS_PORT;
const oscPort = Number(process.env.OSC_PORT) || OSC_DEFAULT_PORT;

/** Engine mode: legacy layer/clip/binding brain (default) or the voice-bus brain.
 * Opt in with `LEDRUMS_ENGINE=voice`; anything else (or unset) keeps legacy.
 * The decision itself lives in `engine-mode.ts` so it is testable (S1). */
const VOICE_MODE = resolveEngineMode(process.env) === 'voice';

// --- remote access: outbound tunnel + room PIN (S3) --------------------------

/** Outbound Cloudflare tunnel config from env (null = don't start at boot — plain `pnpm dev`
 * never spawns cloudflared on its own). Tuned via LEDRUMS_TUNNEL* env (see tunnelConfigFromEnv).
 * The IN-APP Share control works regardless: it starts a plain quick tunnel when no env config
 * exists. */
const tunnelConfig = tunnelConfigFromEnv(process.env, port);
const tunnelAtBoot = tunnelConfig !== null;

/** Room-PIN gate. Open (null) by default; an explicit LEDRUMS_PIN always gates, a boot-enabled
 * tunnel generates a per-run PIN now, and an in-app tunnel start mints one on demand
 * (ensurePin) — so a public URL is NEVER un-gated. */
const pinGate = createMutablePinGate(resolvePin(process.env, tunnelAtBoot));

/** Share-tunnel lifecycle control (in-app start/stop + boot-time env start — one status truth).
 * Every status change re-broadcasts `state` so all clients' Share surfaces follow. */
const tunnelControl = new TunnelControl({
  createManager: (config) => new TunnelManager(config),
  config: tunnelConfig ?? { mode: 'quick', port },
  ensurePinGated: () => {
    pinGate.ensurePin();
  },
  onChange: () => broadcastState(),
  report: (event) => {
    switch (event.kind) {
      case 'ready':
        monitor({ type: 'system', direction: 'local', source: 'server/tunnel', destination: 'remote-access', label: 'Tunnel ready', detail: event.detail });
        console.log(`  Tunnel: ${event.detail}${pinGate.pin ? ` (PIN ${pinGate.pin})` : ''}`);
        return;
      case 'start-failed':
        monitor({ type: 'error', direction: 'local', source: 'server/tunnel', destination: 'remote-access', label: 'Tunnel failed to start', detail: event.detail });
        console.error(`[tunnel] failed to start (is cloudflared installed?): ${event.detail}`);
        return;
      case 'unexpected-exit':
        monitor({ type: 'error', direction: 'local', source: 'server/tunnel', destination: 'remote-access', label: 'Tunnel exited unexpectedly', detail: event.detail });
        console.error(`[tunnel] cloudflared exited unexpectedly (${event.detail}) — remote access is down`);
        return;
      case 'error':
        monitor({ type: 'error', direction: 'local', source: 'server/tunnel', destination: 'remote-access', label: 'Tunnel error', detail: event.detail });
        console.error('[tunnel] error:', event.detail);
    }
  },
});

/** Per-run host-session token (S4 desktop). Handed privately to the desktop app window (via its URL
 * hash) so the host's own window is admitted without the room PIN — while a stray local browser
 * tab/script that merely reached the loopback port cannot. Always present; only meaningful when the
 * gate is active (open gate admits everyone).
 *
 * The desktop shell INJECTS this via `LEDRUMS_HOST_TOKEN` at spawn (#139) so it holds the token
 * before the server has printed anything — the native MIDI bridge must never be gated on scraping a
 * banner line. A standalone `pnpm dev` server injects nothing and mints its own, unchanged. */
const hostToken = resolveHostToken(process.env);

// --- project + host ---------------------------------------------------------

/** The single live project slot. Every authoritative mutation debounce-autosaves here,
 * and {@link initialProject} loads it on boot — so the persisted file is the source of
 * truth across restarts (a crash mid-flight recovers cleanly on the next boot). It is
 * machine-local runtime state, so it uses the repo's `.local` convention and is
 * gitignored (see apps/server/.gitignore) — never committed, never a hand-edited seed. */
const LIVE_PROJECT = 'default.local';

// --- monitor bus + process fault capture (hoisted, S6) ----------------------
// Boot-crash capture must be installed BEFORE the project load below — a corrupt
// project used to kill the process silently. The bus cannot take `broadcastJson`
// directly here (it closes over `clients`, constructed later — a hoisted handler
// firing during boot would throw a ReferenceError out of the handler itself), so
// it writes through a mutable sink that starts as a no-op and is pointed at
// `broadcastJson` once the WS wiring exists. The bus retains 300 events, so
// anything emitted before the sink is live still reaches clients via replay.
let broadcastSink: (msg: ServerMessage) => void = () => {};
const monitorBus = createMonitorBus((m) => broadcastSink(m));
// The error Reporter (#122) subscribes to EVERY Monitor event: non-error events become breadcrumbs,
// error events become deduplicated, shipped reports. Created below iff telemetry is enabled + wired.
let reporter: Reporter | null = null;
// The off-site backups outbox (#123): a SECOND disk-backed ship-queue reusing the #122 transport
// against a `/backups` route on the same Worker. Created in the same enablement block as the
// reporter (endpoint/token present); null under dev / capture-only, where snapshotting stays local.
let backupsQueue: ShipQueue<BackupRecord> | null = null;
function monitor(event: Parameters<typeof monitorBus.emit>[0]): void {
  const full = monitorBus.emit(event);
  reporter?.observe(full);
}

// Server process fault capture (#122): uncaught exceptions + unhandled rejections land on the same
// Monitor bus as an `error` event. `onFatal` darkens the rig then runs the Reporter's synchronous
// queue flush before the process exits, so a crash report reaches disk (and ships on the next boot)
// even on a hard fault.
let flushReportsSync: () => void = () => {};
installProcessErrorCapture({
  monitor,
  onFatal: createFatalHandler({ darken: () => (voiceHost ?? host).darken(), flushReports: () => flushReportsSync() }),
  drainMs: 100,
});

// Boot recovery (S10): file → newest snapshot bundle → seed, with error-class
// discrimination (corruption quarantines; an IO fault fails loudly without renaming).
// The process-error capture above is already installed, so even a throw here is
// captured + reported before exit.
const projectLoad = resolveInitialProject({ name: LIVE_PROJECT, dir: resolveProjectsDir(process.env) });
const project0 = projectLoad.project;
const host = new EngineHost(project0);
/** Voice-bus host, only constructed in voice mode. It owns the live render + output;
 * the legacy `host` still backs the `state` message and the structural reducer so the
 * existing UI/project surface keeps working. Both hosts share the same `project0` object
 * by reference, so the voice host's in-place geometry/routing edits are visible through
 * `host.engine.getProject()` — which is what the autosaver persists. */
const voiceHost = VOICE_MODE ? new VoiceEngineHost(project0) : null;

/** Live persistence: debounce-autosave the authoritative project to {@link LIVE_PROJECT}
 * on every mutation. Async + atomic (temp + rename) and off the engine loop. */
// NOT a createPersistedSlot: the live project IS engine state (the voice host mutates it in place
// through `host.engine.getProject()`), so a slot-owned get/set would be a second source of truth.
const autosaver = createAutosaver(() => saveProjectAsync(LIVE_PROJECT, host.engine.getProject()), 400, {
  onScheduled: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'project', label: 'Project autosave scheduled' }),
  onSaved: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'project', label: 'Project autosave saved' }),
  onError: (message) => monitor({ type: 'error', direction: 'local', source: 'server/autosave', destination: 'project', label: 'Project autosave failed', detail: message }),
});

/** Server-authoritative show library: the authored show library (web-defined schema, persisted
 * as an opaque versioned blob) is owned by the server exactly like the routing project —
 * boot-recovered here, rebroadcast on cold load via {@link stateMessage}, autosaved on every
 * client push, flushed on shutdown. `null` until the first client pushes one (a fresh machine
 * has no file yet); the web then seeds the server from its localStorage cache on connect. */
const showLibrarySlot = createPersistedSlot<ShowLibraryBlob, ReturnType<typeof inspectShowLibraryFile>>({
  label: 'Show library',
  destination: 'show-library',
  inspect: inspectShowLibraryFile,
  // Boot recovery order (S10 + review N7): on a snapshot-recovered boot the bundle is the ONLY
  // source — a bundle without a library seeds empty rather than silently pairing the rolled-back
  // project with the current on-disk file (HARD RULE 2 in boot-project.ts). Clean boots load the
  // standalone file as always.
  load: () =>
    projectLoad.source === 'snapshot'
      ? (isVersionedBlob(projectLoad.showLibrary) ? projectLoad.showLibrary : null)
      : loadShowLibrary(),
  save: saveShowLibraryAsync,
  monitor,
});

/** Server-authoritative SONG library — a second opaque versioned blob, owned + persisted exactly
 * like {@link showLibrarySlot} (boot-recovered, rebroadcast on cold load, autosaved on push,
 * flushed on shutdown). `null` until the first client pushes one. */
const songLibrarySlot = createPersistedSlot<SongLibraryBlob, ReturnType<typeof inspectSongLibraryFile>>({
  label: 'Song library',
  destination: 'song-library',
  inspect: inspectSongLibraryFile,
  load: () =>
    projectLoad.source === 'snapshot'
      ? (isVersionedBlob(projectLoad.songLibrary) ? projectLoad.songLibrary : null)
      : loadSongLibrary(),
  save: saveSongLibraryAsync,
  monitor,
});

// Whole-bundle recovery must PERSIST (review N7): the slots above seed from the snapshot
// bundle in memory only, so without this the next boot would pair old on-disk library files
// with the recovered project. Re-set() each recovered blob so the slot autosaves it to disk,
// exactly like applyRestoredSnapshot; a bundle with no library seeds empty (above) and says
// so on the Monitor — never a silent fallback to the current file.
if (projectLoad.source === 'snapshot') {
  if (isVersionedBlob(projectLoad.showLibrary)) showLibrarySlot.set(projectLoad.showLibrary);
  else monitor({ type: 'error', direction: 'local', source: 'server', destination: 'show-library', label: 'Boot recovery: show library missing from snapshot bundle', detail: 'seeded empty; the on-disk show library file is ignored this run' });
  if (isVersionedBlob(projectLoad.songLibrary)) songLibrarySlot.set(projectLoad.songLibrary);
  else monitor({ type: 'error', direction: 'local', source: 'server', destination: 'song-library', label: 'Boot recovery: song library missing from snapshot bundle', detail: 'seeded empty; the on-disk song library file is ignored this run' });
}

// --- HTTP + static + WS -----------------------------------------------------

// Resolve the web root once at boot — env-overridable so the packaged desktop shell can point
// it at its bundled web dist (default reproduces today's apps/web/dist behavior).
const webRoot = resolveWebRoot(process.env);

let nativeHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;
let updateStatusHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;
let hostEventHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;

const server = createServer((req, res) => {
  if (updateStatusHttpHandler?.(req, res)) return;
  if (nativeHttpHandler?.(req, res)) return;
  if (hostEventHttpHandler?.(req, res)) return;
  serveStatic(req, res, webRoot);
});

const wss = new WebSocketServer({ server, path: WS_PATH });
/** Many simultaneous clients with one editor (S1) — later clients are viewers that live-follow the
 * editor's broadcast. The engine/output loop runs independently, so client count (including zero)
 * never stops transmission. */
const clients = new ClientRegistry<WebSocket>();

/** Sockets that connected VIA the share tunnel (cf-* headers at admit). Such a client can never
 * start/stop the tunnel it rode in on — checked by the message handler. WeakSet: entries vanish
 * with the socket. */
const tunnelClients = new WeakSet<WebSocket>();

// The socket-iterating broadcast closures live in ws-broadcast.ts (S11); its slow-peer
// guard (S14) reaps through the SAME body as the keepalive's onDead, so a struck-out
// peer is indistinguishable from a normal disconnect. Arrow bodies evaluate at sweep
// time, after controllerMonitor exists.
const broadcaster = createBroadcaster<WebSocket>({
  clients,
  encode: encodeServer,
  monitor: (event) => monitor(event),
  onSlowPeerDead: (ws) => {
    clients.remove(ws);
    controllerMonitor.dropWatcher(ws);
    broadcastPresence();
  },
});
const { broadcastJson, broadcastBinary, broadcastPresence, relayToOthers } = broadcaster;

// Point the hoisted monitor bus (S6, above) at the real broadcast now that the
// client registry + encoder wiring exist.
broadcastSink = broadcastJson;

// --- Remote error reporting (#122) ------------------------------------------
// On when the server serves the built web root (packaged/prod), off under the dev proxy;
// `LEDRUMS_TELEMETRY=on|off` overrides. Shipping additionally needs an ingest endpoint + token
// (baked in at build time via env); absent those, capture still feeds the local Monitor but nothing
// leaves the machine. The queue/ship machinery is generic (reused by the backups spec #123).
function appVersion(): string {
  // Desktop config is the version source of truth (passed as env); package.json is the plain-dev
  // fallback so a dev report still carries a version.
  const fromEnv = process.env.LEDRUMS_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

if (isTelemetryEnabled(process.env, { servingBuiltWeb: existsSync(webRoot) })) {
  const endpoint = process.env.LEDRUMS_TELEMETRY_ENDPOINT?.trim();
  const token = process.env.LEDRUMS_TELEMETRY_TOKEN?.trim();
  if (endpoint && token) {
    // Identity resolved once at boot (uptime is read per report). Session id distinguishes runs.
    const session = randomUUID();
    const machine = hostname();
    const osPlatform = platform();
    const osRelease = release();
    const version = appVersion();
    const queue = createShipQueue<ReportRecord>({
      path: join(resolveProjectsDir(process.env), 'error-reports.jsonl'),
      transport: createHttpTransport<ReportRecord>({ endpoint, token }),
      // Upsert by dedup key so a render-loop error firing 120×/s collapses to ONE queued
      // report whose count rises, instead of appending N near-identical rows (#137 C1).
      keyOf: (r) => r.dedupKey,
    });
    reporter = createReporter({
      queue,
      now: () => Date.now(),
      envelope: (origin) => ({
        machine,
        version,
        engineMode: VOICE_MODE ? 'voice' : 'legacy',
        platform: osPlatform,
        osRelease,
        session,
        uptimeMs: Math.round(process.uptime() * 1000),
        origin,
      }),
    });
    // Off-site backups (#123) reuse the same Worker + token via the derived `/backups` route — one
    // second disk-backed queue, no third shipping mechanism. Append-only (no keyOf: each snapshot
    // ships once). Larger byte cap than error reports since a bundle carries the whole project.
    const backupUrl = backupsEndpoint(endpoint);
    if (backupUrl) {
      backupsQueue = createShipQueue<BackupRecord>({
        path: join(resolveProjectsDir(process.env), 'backups-outbox.jsonl'),
        transport: createHttpTransport<BackupRecord>({ endpoint: backupUrl, token }),
        maxItems: 100,
        maxBytes: 8_000_000,
      });
    }
    flushReportsSync = () => {
      reporter?.persistSync();
      backupsQueue?.persistSync();
    };
    // Clean shutdown (boot calls process.exit) + any exit path: flush both queues durably.
    process.on('exit', () => {
      reporter?.persistSync();
      backupsQueue?.persistSync();
    });
    monitor({
      type: 'system',
      direction: 'local',
      source: 'server',
      destination: 'telemetry',
      label: 'Remote error reporting enabled',
      detail: `endpoint=${endpoint}${backupUrl ? ` · backups=${backupUrl}` : ''}`,
    });
  } else {
    monitor({
      type: 'system',
      direction: 'local',
      source: 'server',
      destination: 'telemetry',
      label: 'Remote error reporting: capturing to Monitor only (ingest endpoint/token unset)',
    });
  }
}

for (const event of startupDiagnostics({
  voiceMode: VOICE_MODE,
  port,
  oscPort,
  oscHosts: lanAddresses(),
  webRoot,
  webRootExists: existsSync(webRoot),
  project: projectLoad,
  showLibrary: showLibrarySlot.loadInfo,
  songLibrary: songLibrarySlot.loadInfo,
  tunnel: { enabled: tunnelAtBoot, url: tunnelControl.url },
  pinRequired: pinGate.pin !== null,
  hostTokenPresent: !!hostToken,
})) {
  monitor(event);
}

// Decision 8 (11-decisions.md): a boot-recovery quarantine is never quiet. This error
// event rides the EXISTING Monitor → Reporter → Worker → Discord path (the Reporter
// keys reports by label, so the report key is `boot-recovery/quarantine`); the in-app
// acknowledgement banner reads the same recovery outcome off the `state` message.
if (projectLoad.recovery) {
  monitor({
    type: 'error',
    direction: 'local',
    source: 'server',
    destination: 'boot-recovery',
    label: 'boot-recovery/quarantine',
    detail: `live project unloadable (${projectLoad.recovery.reason}); recovered from ${projectLoad.source === 'snapshot' ? `snapshot ${projectLoad.recovery.bundleId}` : 'seed'}; original quarantined to ${projectLoad.recovery.quarantinedTo ?? 'n/a'} — last edits may be missing`,
  });
}

function monitorInput(msg: ClientMessage, origin: string): void {
  const destination = VOICE_MODE ? 'voice-engine' : 'legacy-engine';
  switch (msg.t) {
    case 'midi':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        destination,
        label: `MIDI ${msg.on ? 'note on' : 'note off'} ${msg.note}`,
        detail: `velocity=${msg.velocity}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
      });
      return;
    case 'cc':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        destination,
        label: `MIDI CC ${msg.controller}`,
        detail: `value=${msg.value}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
      });
      return;
    case 'programChange':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        destination,
        label: `MIDI program ${msg.value}`,
        detail: msg.channel != null ? `channel=${msg.channel}` : undefined,
      });
      return;
    case 'osc':
      monitor({ type: 'input', direction: 'in', source: origin, destination, label: `OSC ${msg.address}`, detail: `value=${msg.value}` });
      return;
    case 'key':
      monitor({ type: 'input', direction: 'in', source: origin, destination, label: `Key ${msg.drumId}:${msg.zone ?? ''}`, detail: `velocity=${msg.velocity ?? 1}` });
      return;
    case 'fireGraph':
      monitor({ type: 'graph', direction: 'in', source: origin, destination, label: `Fire graph ${msg.graphKey}`, detail: `velocity=${msg.velocity}` });
      return;
    case 'recallSection':
      monitor({ type: 'graph', direction: 'in', source: origin, destination, label: `Recall section ${msg.sectionId}`, detail: msg.songId });
      return;
  }
}

/** The remote-access surface for the host UI: tunnel lifecycle status + resolved URL + room
 * PIN. Always present (the Share button always renders, offering Start sharing when off). Only
 * ever reaches already-admitted clients (it rides the `state` message), so an un-authed
 * connection never learns the PIN. */
function tunnelInfo(): TunnelInfo {
  const error = tunnelControl.error;
  return { status: tunnelControl.status, url: tunnelControl.url, pin: pinGate.pin, ...(error ? { error } : {}) };
}

/** Build the full `state` message reflecting the current engine/project. In voice mode
 * the voice host owns the live geometry, so its model is authoritative for the wire. */
function stateMessage(): ServerMessage {
  const model = voiceHost ? voiceHost.getModel() : host.engine.getModel();
  return {
    t: 'state',
    project: host.engine.getProject(),
    model: serializeModel(model),
    effects: effectSpecs(),
    projects: listProjects(),
    output: (voiceHost ?? host).getOutputStatus(),
    showLibrary: showLibrarySlot.get(),
    songLibrary: songLibrarySlot.get(),
    tunnel: tunnelInfo(),
    // Where to point Sensory Percussion / a Max device, and whether the socket is actually
    // bound (#139). Read at send time, so a client always gets the settled truth.
    osc: oscListen,
    // Decision 8: how this server booted, when it did NOT boot cleanly. Every client — including
    // one that connects hours later — learns the live project was recovered and shows the blocking
    // acknowledgement banner. Boot-time truth, so it is constant for the process' lifetime.
    recovery: projectLoad.recovery
      ? { source: projectLoad.source === 'snapshot' ? 'snapshot' : 'recovered-seed', reason: projectLoad.recovery.reason }
      : null,
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);
host.setOutputMonitor(monitor);
voiceHost?.setOutputMonitor(monitor);
voiceHost?.setMonitor(monitor);

// The connection body lives in ws-connection.ts (S12); main.ts only supplies the wiring.
const wsConnectionHandler = createWsConnectionHandler<WebSocket>({
    hostToken,
    pinGate,
    clients,
    tunnelClients,
    monitor,
    broadcastPresence,
    stateMessage,
    replayMonitor: (sendOne) => monitorBus.replay(sendOne),
    monitorInput: (msg) => monitorInput(msg, 'ws'),
    handleClientMessage: (msg, ws) => handleClientMessage(msg, ws),
  dropWatcher: (ws) => controllerMonitor.dropWatcher(ws),
  onKeepaliveSweep: () => broadcaster.sweepSlowPeers(),
});
wss.on('connection', wsConnectionHandler);

// Shared collaborators handed to the extracted message handler. The broadcast/relay closures
// capture the wiring so the handler stays free of module-level state + socket plumbing.
const broadcastState = (): void => broadcastJson(stateMessage());

// --- Project backups (#123) --------------------------------------------------
// Snapshotting is ALWAYS on (local + cheap); only the off-site push follows #122's enablement rule
// (the `backupsQueue` above is null under dev). A snapshot bundles the project + both libraries at
// one instant; a restore replaces all three and cold-loads every client — so it is always coherent.

/** A value is a usable versioned library blob iff it is an object with a numeric `version` — the same
 * opaque-envelope gate the persistence layer applies. Restore only re-adopts a library the snapshot
 * actually carried (a null slot at snapshot time leaves the current library untouched). */
function isVersionedBlob(v: unknown): v is ShowLibraryBlob & SongLibraryBlob {
  return !!v && typeof v === 'object' && typeof (v as { version?: unknown }).version === 'number';
}

/** Restore sink: replace the live project + libraries from a snapshot and reload every client exactly
 * like a cold load (mirrors the `loadProject` path). The project is re-parsed (validated) before it
 * touches the engine; the library slots are the module-level live state `stateMessage` reads. */
function applyRestoredSnapshot(files: SnapshotFiles): void {
  const project = parseProject(files.project);
  host.engine.setProject(project);
  host.reloadOutputSettings();
  autosaver.markDirty();
  if (isVersionedBlob(files.showLibrary)) showLibrarySlot.set(files.showLibrary);
  if (isVersionedBlob(files.songLibrary)) songLibrarySlot.set(files.songLibrary);
  broadcastState();
  monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'backups', label: 'Snapshot restored — engine + clients reloaded' });
}

const snapshotOutbox = backupsQueue;
const snapshotStore: SnapshotStore = createSnapshotStore({
  dir: join(resolveProjectsDir(process.env), 'backups'),
  now: () => Date.now(),
  readCurrent: () => ({ project: host.engine.getProject(), showLibrary: showLibrarySlot.get(), songLibrary: songLibrarySlot.get() }),
  applyRestored: applyRestoredSnapshot,
  onSnapshot: snapshotOutbox ? (meta, bundle) => snapshotOutbox.enqueue(toBackupRecord(hostname(), meta, bundle)) : undefined,
});

// Boot snapshot: capture whatever state the app starts this session with BEFORE any client can
// connect and mutate (the WS server isn't listening until boot() below). Trigger #3.
snapshotStore.snapshot('boot');

/** Change-driven cadence (#123): every 30 min, snapshot iff content changed (the store self-gates on
 * a content hash), so an idle session never churns retention. unref'd — never keeps the process up. */
const SNAPSHOT_CADENCE_MS = 30 * 60_000;
const snapshotTimer = setInterval(() => snapshotStore.snapshot('cadence'), SNAPSHOT_CADENCE_MS);
(snapshotTimer as { unref?: () => void }).unref?.();

/** PixLite controller monitor (S47, group L): discovery + adoption + the client-interest-gated poll
 * loop. ONE HttpPixliteClient per controller (its internal queue enforces the sequential rule). The
 * adopted controller is persisted as `project.controller` (data-only) and rehydrated at boot below.
 * All emitted `controllerStatus`/`controllerDiscovery` messages ride the normal JSON broadcast. */
const controllerMonitor = createControllerMonitor({
  createClient: ({ host: controllerHost, auth }) => new HttpPixliteClient({ host: controllerHost, auth }),
  probe: (controllerHost, timeoutMs) => probeController(controllerHost, timeoutMs),
  getOutputSettings: () => host.engine.getProject().output,
  getController: () => host.engine.getProject().controller,
  persistController: (controller) => {
    // Store on the live project in place (no engine rebuild — the controller isn't geometry), then
    // autosave + re-broadcast state so every client sees the adopted controller.
    host.engine.getProject().controller = controller ?? undefined;
    autosaver.markDirty();
    broadcastState();
  },
  broadcast: broadcastJson,
  monitor,
});

const handleClientMessage = createClientMessageHandler<WebSocket>({
  clients,
  host,
  voiceHost,
  autosaver,
  showLibraryAutosaver: showLibrarySlot.autosaver,
  songLibraryAutosaver: songLibrarySlot.autosaver,
  broadcastJson,
  broadcastPresence,
  broadcastState,
  stateMessage,
  // The live show-library slot is owned here (boot-recovered + autosaved); the handler adopts a
  // pushed library through this setter so stateMessage/the autosaver read the latest.
  setShowLibrary: (lib) => showLibrarySlot.set(lib),
  setSongLibrary: (lib) => songLibrarySlot.set(lib),
  relayToOthers,
  tunnelControl,
  isTunnelClient: (ws) => tunnelClients.has(ws),
  monitor,
  listNetworkAdapters: () => listNetworkAdapters(),
  // Project backups (#123): the list read, the server-side restore (pre-risk snapshot → atomic
  // replace → cold-load reload, all in the store), and the append-only pre-risk trigger the bulk
  // apply seams call before mutating.
  backups: {
    list: () => snapshotStore.list(),
    restore: (id) => snapshotStore.restore(id) !== null,
    // Returns whether the safety snapshot was taken: `snapshot('pre-risk')` returns null only when
    // the WRITE fails (pre-risk never self-gates), so `!== null` is the fail-closed signal the risky-
    // op seams check before mutating — a false makes them refuse rather than overwrite unprotected.
    snapshotPreRisk: () => snapshotStore.snapshot('pre-risk') !== null,
  },
  controller: {
    discover: () => controllerMonitor.discover(),
    adopt: (controllerHost) => controllerMonitor.adopt(controllerHost),
    setAuth: (password) => controllerMonitor.setAuth(password),
    identify: (durationS) => controllerMonitor.identify(durationS),
    setTestData: (pattern) => controllerMonitor.setTestData(pattern),
    backToLive: () => controllerMonitor.backToLive(),
    watch: (key) => controllerMonitor.watch(key),
    dropWatcher: (key) => controllerMonitor.dropWatcher(key),
  },
});

// --- native-MIDI + OTA HTTP routes ------------------------------------------

// The native-MIDI bridge feeds decoded channel MIDI into the same WS client-message handler, but
// has no real client to reply to — a no-op stub satisfies the handler's send/close surface without
// opening a connection.
const nativeInputSocket = {
  close: () => {},
  send: () => {},
} as unknown as WebSocket;

nativeHttpHandler = createNativeMidiHandler({
  hostToken,
  monitorInput: (msg) => monitorInput(msg, 'native-midi'),
  dispatch: (msg) => handleClientMessage(msg, nativeInputSocket),
  monitor,
});

// The desktop shell's own diagnostics (notably "the LEDrums MIDI port failed to come up") land on
// the SAME Monitor stream as the server's native-MIDI errors — a packaged .app has no visible
// stdout, so eprintln! alone means the drummer gets silence (#139).
hostEventHttpHandler = createHostEventHandler({ hostToken, monitor });

updateStatusHttpHandler = createUpdateStatusHandler({
  endpoint: process.env.LEDRUMS_OTA_ENDPOINT,
  currentVersion: process.env.LEDRUMS_APP_VERSION ?? null,
});

// --- OSC input --------------------------------------------------------------

// Raw OSC inputs are engine inputs (not authoring), so they bypass the editor gate entirely —
// the transport-recall handler just needs the voice host + broadcast sink.
const oscVoiceDeps = { voiceHost, broadcastJson };
const oscInput = new OscInput({ port: oscPort });

// The listen surface a third-party sender (Sensory Percussion, a Max device) is configured
// against, plus whether the transport is actually alive. Seeded optimistically because the bind
// resolves a tick after construction; `onStatus` overwrites it with the truth — and always well
// before `server.listen` admits the first client, so no client ever reads the optimistic value.
let oscListen: OscListenInfo = { status: 'listening', port: oscPort, hosts: lanAddresses() };

oscInput.onStatus((status) => {
  oscListen = {
    status: status.state,
    port: status.port,
    hosts: lanAddresses(),
    ...(status.error ? { error: status.error } : {}),
  };
  if (status.state === 'error') {
    // A dead OSC socket used to be completely silent — no terminal line, no Monitor row, no UI.
    // Surface it the same way the native-MIDI bridge surfaces its faults.
    monitor({ type: 'error', direction: 'local', source: 'server/osc', destination: 'osc-input', label: 'OSC input unavailable', detail: `${status.code ?? 'error'} on udp:${status.port} — ${status.error ?? 'socket error'}` });
    console.error(`OSC input unavailable on udp:${status.port}: ${status.error ?? 'socket error'}`);
  } else {
    monitor({ type: 'system', direction: 'local', source: 'server/osc', destination: 'osc-input', label: `OSC bound on udp:${status.port}`, detail: oscListen.hosts.length ? `send OSC to ${oscListen.hosts.map((h) => `${h}:${status.port}`).join(' or ')}` : `send OSC to 127.0.0.1:${status.port}` });
  }
  // Status settles at boot before any client exists, so this normally broadcasts to nobody. It
  // matters for a LATER socket fault: without it, every connected UI keeps claiming OSC is live.
  broadcastJson(stateMessage());
});

oscInput.on((e) => {
  const event = oscToEvent(e, host.engineTimeMs);
  if (!event || event.kind !== 'osc') return;
  monitor({ type: 'input', direction: 'in', source: 'osc', destination: VOICE_MODE ? 'voice-engine' : 'legacy-engine', label: `OSC ${event.address}`, detail: `value=${event.value}` });
  if (voiceHost) {
    // A section-recall address (e.g. from a show-control system) is always consumed by the
    // recall handler before the zone-map, exactly like the WS osc path; anything else is a
    // normal OSC input.
    if (parseSectionRecallAddress(event.address) !== null) {
      const target = oscRecall(voiceHost.getShow(), event.address, event.value);
      if (target) applyTransportRecall(oscVoiceDeps, target, { kind: 'osc', label: event.address, value: event.value });
      return;
    }
    voiceHost.applyInput({ kind: 'osc', address: event.address, value: event.value });
  } else {
    host.markInput();
    host.engine.applyEvent(event);
  }
  broadcastJson({ t: 'input', kind: 'osc', label: event.address, value: event.value });
});

// --- periodic stats ---------------------------------------------------------

// The adaptation policy (and the cadence constant) lives in stats-frame.ts as a pure
// function; this timer is just the clock. `beatsPerBar` is read fresh each tick off the
// legacy host's project — the authoritative transport, even in voice mode.
const statsTimer = setInterval(() => {
  broadcastJson(
    buildStatsMessage({
      voiceHost,
      host,
      beatsPerBar: host.engine.getProject().composition.transport.beatsPerBar,
    }),
  );
}, STATS_INTERVAL_MS);

// --- boot + shutdown --------------------------------------------------------

// Rehydrate a controller already adopted on the loaded project (boot recovery) — sets up the
// per-controller client so the first watcher's poll reports live status. No traffic until watched.
controllerMonitor.hydrate();

boot({
  server,
  wss,
  clients,
  wsKeepalive: wsConnectionHandler,
  host,
  voiceHost,
  oscInput,
  controllerMonitor,
  port,
  oscPort,
  voiceMode: VOICE_MODE,
  statsTimer,
  snapshotTimer,
  autosaver,
  showLibraryAutosaver: showLibrarySlot.autosaver,
  songLibraryAutosaver: songLibrarySlot.autosaver,
  tunnelControl,
  tunnelAtBoot,
  pin: pinGate.pin,
  hostToken,
  monitor,
});
