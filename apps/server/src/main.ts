import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
import { listProjects, loadProject, projectExists, saveProjectAsync } from './projects';
import { loadShowLibrary, saveShowLibraryAsync, type ShowLibraryBlob } from './show-library';
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
import {
  decodeClient,
  effectSpecs,
  encodeServer,
  serializeModel,
  type ClientMessage,
  type MonitorEvent,
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

function initialProject(): Project {
  // Boot recovery: the live project file is authoritative — load + integrity-check it if
  // present (failing loudly on dangling refs). Only on a truly fresh machine (no saved
  // file) do we seed from the canonical in-code definition (defaultProject → DEFAULT_KIT),
  // so there is no hand-edited file to drift from the engine/lab kit. Once any edit lands,
  // the autosaver writes this slot and it is what subsequent boots restore.
  if (!projectExists(LIVE_PROJECT)) return defaultProject();
  return loadProject(LIVE_PROJECT);
}

const project0 = initialProject();
const host = new EngineHost(project0);
/** Voice-bus host, only constructed in voice mode. It owns the live render + output;
 * the legacy `host` still backs the `state` message and the structural reducer so the
 * existing UI/project surface keeps working. Both hosts share the same `project0` object
 * by reference, so the voice host's in-place geometry/routing edits are visible through
 * `host.engine.getProject()` — which is what the autosaver persists. */
const voiceHost = VOICE_MODE ? new VoiceEngineHost(project0) : null;

/** Live persistence: debounce-autosave the authoritative project to {@link LIVE_PROJECT}
 * on every mutation. Async + atomic (temp + rename) and off the engine loop. */
const autosaver = createAutosaver(() => saveProjectAsync(LIVE_PROJECT, host.engine.getProject()));

/** Server-authoritative show library: the authored show library (web-defined schema, persisted
 * as an opaque versioned blob) is owned by the server exactly like the routing project —
 * boot-recovered here, rebroadcast on cold load via {@link stateMessage}, autosaved on every
 * client push, flushed on shutdown. `null` until the first client pushes one (a fresh machine
 * has no file yet); the web then seeds the server from its localStorage cache on connect. */
let liveShowLibrary: ShowLibraryBlob | null = loadShowLibrary();

/** Debounce-autosave the live show library (async + atomic + off-loop). The save sink reads
 * the current slot at call time so the latest push is persisted; a null slot (nothing pushed
 * yet) is a no-op. */
const showLibraryAutosaver = createAutosaver(() =>
  liveShowLibrary ? saveShowLibraryAsync(liveShowLibrary) : Promise.resolve(),
);

// --- HTTP + static + WS -----------------------------------------------------

// Resolve the web root once at boot — env-overridable so the packaged desktop shell can point
// it at its bundled web dist (default reproduces today's apps/web/dist behavior).
const webRoot = resolveWebRoot(process.env);

let nativeHttpHandler: ((req: IncomingMessage, res: ServerResponse) => boolean) | null = null;

const server = createServer((req, res) => {
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

let monitorSeq = 1;
function monitor(event: Omit<MonitorEvent, 'id' | 'time'>): void {
  broadcastJson({ t: 'monitor', event: { id: monitorSeq++, time: Date.now(), ...event } });
}

function monitorInput(msg: ClientMessage, origin: string): void {
  switch (msg.t) {
    case 'midi':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        label: `MIDI ${msg.on ? 'note on' : 'note off'} ${msg.note}`,
        detail: `velocity=${msg.velocity}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
      });
      return;
    case 'cc':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        label: `MIDI CC ${msg.controller}`,
        detail: `value=${msg.value}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
      });
      return;
    case 'programChange':
      monitor({
        type: 'input',
        direction: 'in',
        source: origin,
        label: `MIDI program ${msg.value}`,
        detail: msg.channel != null ? `channel=${msg.channel}` : undefined,
      });
      return;
    case 'osc':
      monitor({ type: 'input', direction: 'in', source: origin, label: `OSC ${msg.address}`, detail: `value=${msg.value}` });
      return;
    case 'key':
      monitor({ type: 'input', direction: 'in', source: origin, label: `Key ${msg.drumId}:${msg.zone ?? ''}`, detail: `velocity=${msg.velocity ?? 1}` });
      return;
    case 'recallSection':
      monitor({ type: 'graph', direction: 'in', source: origin, label: `Recall section ${msg.sectionId}`, detail: msg.songId });
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
    tunnel: tunnelInfo(),
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);
host.setOutputMonitor(monitor);
voiceHost?.setOutputMonitor(monitor);

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
  broadcastPresence();
  ws.send(encodeServer(stateMessage()));

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
  broadcastJson,
  broadcastPresence,
  broadcastState,
  stateMessage,
  // The live show-library slot is owned here (boot-recovered + autosaved); the handler adopts a
  // pushed library through this setter so stateMessage/the autosaver read the latest.
  setShowLibrary: (lib) => {
    liveShowLibrary = lib;
  },
  relayToOthers,
});

const NATIVE_MIDI_PATH = '/api/native-midi';

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
      sendPlain(res, 400, err instanceof Error ? err.message : 'bad request');
    }
  });
  return true;
}

nativeHttpHandler = handleNativeMidiHttp;

// --- OSC input --------------------------------------------------------------

// Raw OSC inputs are engine inputs (not authoring), so they bypass the editor gate entirely —
// the transport-recall handler just needs the voice host + broadcast sink.
const oscVoiceDeps = { voiceHost, broadcastJson };
const oscInput = new OscInput({ port: oscPort });
oscInput.on((e) => {
  const event = oscToEvent(e, host.engineTimeMs);
  if (!event || event.kind !== 'osc') return;
  monitor({ type: 'input', direction: 'in', source: 'osc', label: `OSC ${event.address}`, detail: `value=${event.value}` });
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
      voice: { voiceCount: s.engine.voiceCount, busLevels: s.engine.busLevels },
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
  tunnelManager,
  pin: pinGate.pin,
  hostToken,
  broadcastState,
});
