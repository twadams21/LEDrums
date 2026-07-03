import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import {
  defaultProject,
  WS_PATH,
  WS_PORT,
  type Project,
} from '@ledrums/core';
import { OscInput, OSC_DEFAULT_PORT } from '@ledrums/io';
import { WebSocketServer, type WebSocket } from 'ws';
import { EngineHost } from './engine-host';
import { VoiceEngineHost } from './voice-engine-host';
import {
  oscToEvent,
  oscRecall,
  parseSectionRecallAddress,
} from './input-router';
import { listProjects, loadProject, projectExists, projectFilePath, saveProjectAsync } from './projects';
import { inspectShowLibraryFile, loadShowLibrary, saveShowLibraryAsync, type ShowLibraryBlob } from './show-library';
import { inspectSongLibraryFile, loadSongLibrary, saveSongLibraryAsync, type SongLibraryBlob } from './song-library';
import { createAutosaver } from './autosave';
import { ClientRegistry } from './client-registry';
import { serveStatic, resolveWebRoot } from './static-host';
import { TunnelManager, tunnelConfigFromEnv } from './tunnel-manager';
import {
  admitDecision,
  createPinGate,
  generateHostToken,
  isTrustedHost,
  resolvePin,
} from './pin-gate';
import { boot } from './boot';
import { createClientMessageHandler } from './handlers/client-message';
import { applyTransportRecall } from './handlers/voice-input';
import { startupDiagnostics } from './diagnostics';
import { createMonitorBus } from './monitor';
import {
  decodeClient,
  effectSpecs,
  encodeServer,
  serializeModel,
  type ClientMessage,
  type ServerMessage,
  type TunnelInfo,
} from './ws-protocol';

const port = Number(process.env.PORT) || WS_PORT;
const oscPort = Number(process.env.OSC_PORT) || OSC_DEFAULT_PORT;

/** Engine mode: legacy layer/clip/binding brain (default) or the voice-bus brain.
 * Opt in with `LEDRUMS_ENGINE=voice`; anything else (or unset) keeps legacy. */
const VOICE_MODE = (process.env.LEDRUMS_ENGINE ?? '').toLowerCase() === 'voice';

// --- remote access: outbound tunnel + room PIN (S3) --------------------------

/** Outbound Cloudflare tunnel config (null = disabled, the default — so plain `pnpm dev`
 * never spawns cloudflared). Enabled + tuned via LEDRUMS_TUNNEL* env (see tunnelConfigFromEnv). */
const tunnelConfig = tunnelConfigFromEnv(process.env, port);
const tunnelManager = tunnelConfig ? new TunnelManager(tunnelConfig) : null;

/** Room-PIN gate. Open (null) by default; an explicit LEDRUMS_PIN always gates, and an enabled
 * tunnel auto-generates a per-run PIN so a public URL is never un-gated. */
const pinGate = createPinGate(resolvePin(process.env, tunnelManager !== null));

/** Per-run host-session token (S4 desktop). Handed privately to the desktop app window (via its URL
 * hash, printed in the boot banner for the shell to read) so the host's own window is admitted
 * without the room PIN — while a stray local browser tab/script that merely reached the loopback
 * port cannot. Always minted; only meaningful when the gate is active (open gate admits everyone). */
const hostToken = generateHostToken();

// --- project + host ---------------------------------------------------------

/** The single live project slot. Every authoritative mutation debounce-autosaves here,
 * and {@link initialProject} loads it on boot — so the persisted file is the source of
 * truth across restarts (a crash mid-flight recovers cleanly on the next boot). It is
 * machine-local runtime state, so it uses the repo's `.local` convention and is
 * gitignored (see apps/server/.gitignore) — never committed, never a hand-edited seed. */
const LIVE_PROJECT = 'default.local';

function initialProject(): { project: Project; source: 'seed' | 'file'; name: string; path: string } {
  // Boot recovery: the live project file is authoritative — load + integrity-check it if
  // present (failing loudly on dangling refs). Only on a truly fresh machine (no saved
  // file) do we seed from the canonical in-code definition (defaultProject → DEFAULT_KIT),
  // so there is no hand-edited file to drift from the engine/lab kit. Once any edit lands,
  // the autosaver writes this slot and it is what subsequent boots restore.
  const path = projectFilePath(LIVE_PROJECT);
  if (!projectExists(LIVE_PROJECT)) return { project: defaultProject(), source: 'seed', name: LIVE_PROJECT, path };
  return { project: loadProject(LIVE_PROJECT), source: 'file', name: LIVE_PROJECT, path };
}

const projectLoad = initialProject();
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
const showLibraryLoad = inspectShowLibraryFile();
let liveShowLibrary: ShowLibraryBlob | null = loadShowLibrary();

/** Server-authoritative SONG library — a second opaque versioned blob, owned + persisted exactly
 * like {@link liveShowLibrary} (boot-recovered, rebroadcast on cold load, autosaved on push,
 * flushed on shutdown). `null` until the first client pushes one. */
const songLibraryLoad = inspectSongLibraryFile();
let liveSongLibrary: SongLibraryBlob | null = loadSongLibrary();

/** Debounce-autosave the live show library (async + atomic + off-loop). The save sink reads
 * the current slot at call time so the latest push is persisted; a null slot (nothing pushed
 * yet) is a no-op. */
const showLibraryAutosaver = createAutosaver(
  () => (liveShowLibrary ? saveShowLibraryAsync(liveShowLibrary) : Promise.resolve()),
  400,
  {
    onScheduled: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'show-library', label: 'Show library autosave scheduled' }),
    onSaved: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'show-library', label: 'Show library autosave saved' }),
    onError: (message) => monitor({ type: 'error', direction: 'local', source: 'server/autosave', destination: 'show-library', label: 'Show library autosave failed', detail: message }),
  },
);

/** Debounce-autosave the live song library (mirrors {@link showLibraryAutosaver}). */
const songLibraryAutosaver = createAutosaver(
  () => (liveSongLibrary ? saveSongLibraryAsync(liveSongLibrary) : Promise.resolve()),
  400,
  {
    onScheduled: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'song-library', label: 'Song library autosave scheduled' }),
    onSaved: () => monitor({ type: 'persistence', direction: 'local', source: 'server', destination: 'song-library', label: 'Song library autosave saved' }),
    onError: (message) => monitor({ type: 'error', direction: 'local', source: 'server/autosave', destination: 'song-library', label: 'Song library autosave failed', detail: message }),
  },
);

// --- HTTP + static + WS -----------------------------------------------------

// Resolve the web root once at boot — env-overridable so the packaged desktop shell can point
// it at its bundled web dist (default reproduces today's apps/web/dist behavior).
const webRoot = resolveWebRoot(process.env);

let nativeHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;
let updateStatusHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;

const server = createServer((req, res) => {
  if (updateStatusHttpHandler?.(req, res)) return;
  if (nativeHttpHandler?.(req, res)) return;
  serveStatic(req, res, webRoot);
});

const wss = new WebSocketServer({ server, path: WS_PATH });
/** Many simultaneous clients with one editor (S1) — later clients are viewers that live-follow the
 * editor's broadcast. The engine/output loop runs independently, so client count (including zero)
 * never stops transmission. */
const clients = new ClientRegistry<WebSocket>();

function broadcastJson(msg: ServerMessage): void {
  const data = encodeServer(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const monitorBus = createMonitorBus(broadcastJson);
function monitor(event: Parameters<typeof monitorBus.emit>[0]): void {
  monitorBus.emit(event);
}

for (const event of startupDiagnostics({
  voiceMode: VOICE_MODE,
  port,
  oscPort,
  webRoot,
  webRootExists: existsSync(webRoot),
  project: projectLoad,
  showLibrary: showLibraryLoad,
  songLibrary: songLibraryLoad,
  tunnel: { enabled: tunnelManager !== null, url: tunnelManager?.url ?? null },
  pinRequired: pinGate.pin !== null,
  hostTokenPresent: !!hostToken,
})) {
  monitor(event);
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

/** Re-broadcast presence to every client (each gets its own `youAreEditor`). Called on any
 * join/leave so every client's editor/viewer role + headcount stays current. */
function broadcastPresence(): void {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(encodeServer({ t: 'presence', ...clients.presenceFor(ws) }));
  }
}

function broadcastBinary(rgb: Uint8Array): void {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(rgb, { binary: true });
  }
}

/** The remote-access surface for the host UI: the resolved tunnel URL + room PIN. Null when
 * neither is configured (plain local dev). Only ever reaches already-admitted clients (it rides
 * the `state` message), so an un-authed connection never learns the PIN. */
function tunnelInfo(): TunnelInfo | null {
  if (tunnelManager === null && pinGate.pin === null) return null;
  return { url: tunnelManager?.url ?? null, pin: pinGate.pin };
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
    showLibrary: liveShowLibrary,
    songLibrary: liveSongLibrary,
    tunnel: tunnelInfo(),
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);
host.setOutputMonitor(monitor);
voiceHost?.setOutputMonitor(monitor);
voiceHost?.setMonitor(monitor);

wss.on('connection', (ws, req) => {
  // PIN gate (S3): refuse a connection with a wrong/absent room PIN BEFORE it is admitted to the
  // registry or sent any presence/state/frames — so an un-authed client can neither view nor
  // mutate. The PIN rides the connect URL query (`?pin=…`). An open gate (no PIN configured)
  // admits everyone, so plain local dev is unchanged.
  //
  // Host bypass: the host's OWN app window is admitted without a PIN — but loopback alone is not
  // proof of that (any local tab/script is also loopback), so the bypass requires the unguessable
  // per-run host token the window was handed (plus loopback + not-via-cloudflared). Remote clients
  // (cf-* headers) and LAN peers (non-loopback) can never satisfy it, so both stay gated.
  const trustedLocal = isTrustedHost({
    remoteAddress: req.socket.remoteAddress,
    headers: req.headers,
    url: req.url,
    hostToken,
  });
  const decision = admitDecision(req.url, pinGate, trustedLocal);
  if (!decision.ok) {
    ws.close(decision.code, decision.reason);
    return;
  }

  // Admit additively (no eviction) — the first client auto-claims the editor slot, later clients
  // are viewers. Broadcast presence to EVERY client FIRST (so this newcomer learns its role before
  // the `state` below — messages are ordered on the socket), then ship its initial state.
  clients.admit(ws);
  monitor({ type: 'system', direction: 'local', source: 'server', destination: 'ws', label: 'WebSocket client accepted' });
  broadcastPresence();
  ws.send(encodeServer(stateMessage()));
  monitorBus.replay((msg) => ws.send(encodeServer(msg)));

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return; // clients send JSON only
    let handled = false;
    try {
      const msg = decodeClient(raw.toString());
      handled = true;
      monitorInput(msg, 'ws');
      handleClientMessage(msg, ws);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (handled) {
        // Error escaped the handler — log, but keep the socket alive.
        console.error('[ws] handler error:', message);
      }
      monitor({ type: 'error', direction: 'local', source: 'server/ws', label: handled ? 'WebSocket handler error' : 'WebSocket decode error', detail: message });
      ws.send(encodeServer({ t: 'error', message }));
    }
  });

  // On disconnect, drop the socket and re-broadcast presence (headcount changed, and the editor
  // slot may have moved per the registry's election rule).
  ws.on('close', () => {
    clients.remove(ws);
    broadcastPresence();
  });
  ws.on('error', () => {
    clients.remove(ws);
    broadcastPresence();
  });
});

// Shared collaborators handed to the extracted message handler. The broadcast/relay closures
// capture the wiring so the handler stays free of module-level state + socket plumbing.
const broadcastState = (): void => broadcastJson(stateMessage());

/** Relay a server message to every client EXCEPT `sender` (the live showLibrary relay). */
function relayToOthers(sender: WebSocket, msg: ServerMessage): void {
  const data = encodeServer(msg);
  for (const other of clients) {
    if (other !== sender && other.readyState === other.OPEN) other.send(data);
  }
}

const handleClientMessage = createClientMessageHandler<WebSocket>({
  clients,
  host,
  voiceHost,
  autosaver,
  showLibraryAutosaver,
  songLibraryAutosaver,
  broadcastJson,
  broadcastPresence,
  broadcastState,
  stateMessage,
  // The live show-library slot is owned here (boot-recovered + autosaved); the handler adopts a
  // pushed library through this setter so stateMessage/the autosaver read the latest.
  setShowLibrary: (lib) => {
    liveShowLibrary = lib;
  },
  setSongLibrary: (lib) => {
    liveSongLibrary = lib;
  },
  relayToOthers,
  monitor,
});

const NATIVE_MIDI_PATH = '/api/native-midi';
const UPDATE_STATUS_PATH = '/api/update-status';

interface UpdateStatusResponse {
  available: boolean;
  version: string | null;
  currentVersion: string | null;
  canInstall: false;
  error?: string;
}

function isNativeMidiMessage(msg: ClientMessage): msg is Extract<ClientMessage, { t: 'midi' | 'cc' | 'programChange' }> {
  return msg.t === 'midi' || msg.t === 'cc' || msg.t === 'programChange';
}

function sendPlain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const nativeInputSocket = {
  close: () => {},
  send: () => {},
} as unknown as WebSocket;

function handleNativeMidiHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path !== NATIVE_MIDI_PATH) return false;

  if (req.method !== 'POST') {
    sendPlain(res, 405, 'method not allowed');
    return true;
  }

  const trustedLocal = isTrustedHost({
    remoteAddress: req.socket.remoteAddress,
    headers: req.headers,
    url: req.url,
    hostToken,
  });
  if (!trustedLocal) {
    sendPlain(res, 401, 'unauthorized');
    return true;
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 4096) req.destroy(new Error('native MIDI payload too large'));
  });
  req.on('error', () => {
    if (!res.headersSent) sendPlain(res, 400, 'bad request');
  });
  req.on('end', () => {
    try {
      const msg = decodeClient(raw);
      if (!isNativeMidiMessage(msg)) {
        sendPlain(res, 400, 'unsupported native MIDI message');
        return;
      }
      monitorInput(msg, 'native-midi');
      handleClientMessage(msg, nativeInputSocket);
      sendPlain(res, 204, '');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bad request';
      monitor({ type: 'error', direction: 'local', source: 'server/native-midi', label: 'Native MIDI error', detail: message });
      sendPlain(res, 400, message);
    }
  });
  return true;
}

nativeHttpHandler = handleNativeMidiHttp;

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const av = Number.isFinite(pa[i]) ? pa[i]! : 0;
    const bv = Number.isFinite(pb[i]) ? pb[i]! : 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function sendJson(res: ServerResponse, status: number, body: UpdateStatusResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function handleUpdateStatusHttp(req: IncomingMessage, res: ServerResponse): boolean {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path !== UPDATE_STATUS_PATH) return false;

  if (req.method !== 'GET') {
    sendJson(res, 405, { available: false, version: null, currentVersion: null, canInstall: false, error: 'method not allowed' });
    return true;
  }

  const endpoint = process.env.LEDRUMS_OTA_ENDPOINT;
  const currentVersion = process.env.LEDRUMS_APP_VERSION ?? null;
  if (!endpoint || !currentVersion) {
    sendJson(res, 200, { available: false, version: null, currentVersion, canInstall: false, error: 'OTA status is unavailable on this server.' });
    return true;
  }

  void (async () => {
    try {
      const response = await fetch(endpoint, { redirect: 'follow' });
      if (!response.ok) throw new Error(`manifest returned ${response.status}`);
      const manifest = (await response.json()) as { version?: unknown };
      const version = typeof manifest.version === 'string' ? manifest.version : null;
      sendJson(res, 200, {
        available: !!version && compareVersions(version, currentVersion) > 0,
        version,
        currentVersion,
        canInstall: false,
      });
    } catch (err) {
      sendJson(res, 200, {
        available: false,
        version: null,
        currentVersion,
        canInstall: false,
        error: err instanceof Error ? err.message : 'update check failed',
      });
    }
  })();
  return true;
}

updateStatusHttpHandler = handleUpdateStatusHttp;

// --- OSC input --------------------------------------------------------------

// Raw OSC inputs are engine inputs (not authoring), so they bypass the editor gate entirely —
// the transport-recall handler just needs the voice host + broadcast sink.
const oscVoiceDeps = { voiceHost, broadcastJson };
const oscInput = new OscInput({ port: oscPort });
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

const statsTimer = setInterval(() => {
  if (voiceHost) {
    const s = voiceHost.getStats();
    // Adapt the voice engine's stats onto the legacy `stats` shape, plus the additive
    // `voice` extension carrying voiceCount + per-bus levels.
    broadcastJson({
      t: 'stats',
      stats: {
        timeMs: s.engine.timeMs,
        beat: s.engine.beat,
        bar: Math.floor(s.engine.beat / host.engine.getProject().composition.transport.beatsPerBar),
        activeTriggers: s.engine.voiceCount,
        tickCount: 0,
        pixelCount: voiceHost.getModel().pixelCount,
      },
      latencyMs: s.latencyMs,
      fps: s.fps,
      output: s.output,
      voice: { voiceCount: s.engine.voiceCount, busLevels: s.engine.busLevels, voices: s.engine.voices },
    });
    return;
  }
  const s = host.getStats();
  broadcastJson({ t: 'stats', stats: s.engine, latencyMs: s.latencyMs, fps: s.fps, output: s.output });
}, 500);

// --- boot + shutdown --------------------------------------------------------

boot({
  server,
  wss,
  clients,
  host,
  voiceHost,
  oscInput,
  port,
  oscPort,
  voiceMode: VOICE_MODE,
  statsTimer,
  autosaver,
  showLibraryAutosaver,
  songLibraryAutosaver,
  tunnelManager,
  pin: pinGate.pin,
  hostToken,
  broadcastState,
  monitor,
});
