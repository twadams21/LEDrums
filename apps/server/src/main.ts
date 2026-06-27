import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
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
  applyClientMessage,
  oscToEvent,
  oscRecall,
  programChangeRecall,
  sectionIndexRecall,
  SECTION_RECALL_CC,
  type RecallTarget,
} from './input-router';
import { listProjects, loadProject, projectExists, saveProject, saveProjectAsync } from './projects';
import { createAutosaver } from './autosave';
import { SingleClientLock } from './client-lock';
import { serveStatic } from './static-host';
import {
  decodeClient,
  effectSpecs,
  encodeServer,
  serializeModel,
  type ServerMessage,
} from './ws-protocol';

const port = Number(process.env.PORT) || WS_PORT;
const oscPort = Number(process.env.OSC_PORT) || OSC_DEFAULT_PORT;

/** Engine mode: legacy layer/clip/binding brain (default) or the voice-bus brain.
 * Opt in with `LEDRUMS_ENGINE=voice`; anything else (or unset) keeps legacy. */
const VOICE_MODE = (process.env.LEDRUMS_ENGINE ?? '').toLowerCase() === 'voice';

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

// --- HTTP + static + WS -----------------------------------------------------

const server = createServer((req, res) => {
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: WS_PATH });
/** Exactly one live client (newest wins) — a new connection supersedes the old. The
 * engine/output loop runs independently, so client churn never stops transmission. */
const clients = new SingleClientLock<WebSocket>();

function broadcastJson(msg: ServerMessage): void {
  const data = encodeServer(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastBinary(rgb: Uint8Array): void {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(rgb, { binary: true });
  }
}

/** Apply a resolved global transport recall to the voice engine + echo it to the input
 * monitor. Reuses the engine's existing `recallSection` input (which also activates the
 * song), so a Program Change / CC#0 / OSC recall drives the same path the UI does. */
function applyTransportRecall(target: RecallTarget, monitor: { kind: 'midi' | 'osc'; label: string; value: number }): void {
  if (!voiceHost) return;
  voiceHost.applyInput({ kind: 'recallSection', songId: target.songId, sectionId: target.sectionId });
  broadcastJson({ t: 'input', kind: monitor.kind, label: monitor.label, value: monitor.value });
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
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);

wss.on('connection', (ws) => {
  // Single-client lock: admitting this socket cleanly closes any prior one (newest wins),
  // so a reconnect after a crash replaces the dead socket without wedging.
  clients.admit(ws);
  ws.send(encodeServer(stateMessage()));

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return; // clients send JSON only
    let handled = false;
    try {
      const msg = decodeClient(raw.toString());
      handled = true;
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

  ws.on('close', () => clients.remove(ws));
  ws.on('error', () => clients.remove(ws));
});

type ClientMessage = ReturnType<typeof decodeClient>;

function handleClientMessage(msg: ClientMessage, ws: WebSocket): void {
  // Project IO is handled here, not by the reducer.
  if (msg.t === 'loadProject') {
    const loaded = loadProject(msg.name);
    host.engine.setProject(loaded);
    host.reloadOutputSettings();
    broadcastJson(stateMessage());
    autosaver.markDirty(); // the loaded project is now the live state — persist it
    return;
  }
  if (msg.t === 'saveProject') {
    saveProject(msg.name, host.engine.getProject());
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return;
  }
  if (msg.t === 'listProjects') {
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return;
  }

  // --- voice-mode inputs (only meaningful when the voice host is running) ---
  if (voiceHost) {
    // Global transport recall — STEP 0, before the per-trigger zone-map. A Program Change
    // selects a song (+ its first section); CC#0 recalls a section in the active song.
    if (msg.t === 'programChange') {
      const target = programChangeRecall(voiceHost.getShow(), msg.value);
      if (target) applyTransportRecall(target, { kind: 'midi', label: `PC ${msg.value}`, value: msg.value });
      return;
    }
    if (msg.t === 'cc') {
      if (msg.controller === SECTION_RECALL_CC) {
        const target = sectionIndexRecall(voiceHost.getShow(), voiceHost.getActiveSongId(), msg.value);
        if (target) applyTransportRecall(target, { kind: 'midi', label: `CC0 ${msg.value}`, value: msg.value });
      }
      // Other controllers have no engine path yet — consume without falling through.
      return;
    }
    if (msg.t === 'setShow') {
      voiceHost.setShow(msg.show);
      return;
    }
    if (msg.t === 'key') {
      voiceHost.applyInput({ kind: 'key', drumId: msg.drumId, zone: msg.zone, velocity: msg.velocity });
      broadcastJson({ t: 'input', kind: 'midi', label: `${msg.drumId}:${msg.zone ?? ''}`, value: msg.velocity ?? 1 });
      return;
    }
    if (msg.t === 'recallSection') {
      voiceHost.applyInput({ kind: 'recallSection', songId: msg.songId, sectionId: msg.sectionId });
      return;
    }
    if (msg.t === 'midi') {
      if (msg.on && msg.velocity > 0) {
        voiceHost.applyInput({ kind: 'noteOn', note: msg.note, velocity: msg.velocity / 127 });
      } else {
        voiceHost.applyInput({ kind: 'noteOff', note: msg.note });
      }
      broadcastJson({ t: 'input', kind: 'midi', label: `note ${msg.note}`, value: msg.velocity / 127 });
      return;
    }
    if (msg.t === 'osc') {
      // A section-recall address resolves before the zone-map; anything else is a normal
      // OSC input forwarded through the patch zone-map / direct binding.
      const target = oscRecall(voiceHost.getShow(), msg.address, msg.value);
      if (target) {
        applyTransportRecall(target, { kind: 'osc', label: msg.address, value: msg.value });
        return;
      }
      voiceHost.applyInput({ kind: 'osc', address: msg.address, value: msg.value });
      broadcastJson({ t: 'input', kind: 'osc', label: msg.address, value: msg.value });
      return;
    }
  } else if (
    msg.t === 'setShow' ||
    msg.t === 'key' ||
    msg.t === 'recallSection' ||
    msg.t === 'cc' ||
    msg.t === 'programChange'
  ) {
    // These only apply to the voice engine; ignore in legacy mode.
    return;
  }

  // midi/osc are inputs — stamp wall time for latency before the reducer enqueues.
  if (msg.t === 'midi' || msg.t === 'osc') host.markInput();

  const result = applyClientMessage(host.engine, msg, host.engineTimeMs);

  // Voice mode: the legacy reducer above mutated the shared project, but the voice host
  // owns the live render + output. Propagate kit/output/input edits so real device
  // behaviour changes without a restart. (setKitOutputs has no legacy reducer case, so
  // the host mutation here is what actually applies it.)
  if (voiceHost) {
    switch (msg.t) {
      case 'setKitTransform':
        voiceHost.setKitTransform(msg.drumId, {
          ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
          ...(msg.rotation !== undefined ? { rotation: msg.rotation } : {}),
          ...(msg.localSpinDeg !== undefined ? { localSpinDeg: msg.localSpinDeg } : {}),
          ...(msg.startAngleDeg !== undefined ? { startAngleDeg: msg.startAngleDeg } : {}),
          ...(msg.pixelsPerHoop !== undefined ? { pixelsPerHoop: msg.pixelsPerHoop } : {}),
        });
        break;
      case 'setKitOutputs':
        voiceHost.setKitOutputs(msg.outputs);
        break;
      case 'setOutput':
        voiceHost.setOutput({
          ...(msg.state !== undefined ? { state: msg.state } : {}),
          ...(msg.protocol !== undefined ? { protocol: msg.protocol } : {}),
          ...(msg.host !== undefined ? { host: msg.host } : {}),
          ...(msg.rgbOrder !== undefined ? { rgbOrder: msg.rgbOrder } : {}),
          ...(msg.fps !== undefined ? { fps: msg.fps } : {}),
          ...(msg.broadcast !== undefined ? { broadcast: msg.broadcast } : {}),
          ...(msg.priority !== undefined ? { priority: msg.priority } : {}),
          ...(msg.port !== undefined ? { port: msg.port } : {}),
          ...(msg.iface !== undefined ? { iface: msg.iface } : {}),
        });
        break;
      case 'setInputMap':
        voiceHost.setInputMap(msg.inputMap);
        break;
    }
  }

  // Output settings or geometry changed → re-apply output + send fresh state.
  // (setKitOutputs has no legacy reducer case, so it never sets result.structural; mark
  // dirty here so the output-topology reorder is persisted too.)
  if (msg.t === 'setOutput' || msg.t === 'setKitTransform' || msg.t === 'setKitOutputs') {
    host.reloadOutputSettings();
    broadcastJson(stateMessage());
    autosaver.markDirty();
    return;
  }

  if (result.structural) {
    broadcastJson(stateMessage());
    autosaver.markDirty();
  }
  if (result.monitor) {
    broadcastJson({ t: 'input', kind: result.monitor.kind, label: result.monitor.label, value: result.monitor.value });
  }
}

// --- OSC input --------------------------------------------------------------

const oscInput = new OscInput({ port: oscPort });
oscInput.on((e) => {
  const event = oscToEvent(e, host.engineTimeMs);
  if (!event || event.kind !== 'osc') return;
  if (voiceHost) {
    // A section-recall address (e.g. from a show-control system) recalls before the
    // zone-map, exactly like the WS osc path; anything else is a normal OSC input.
    const target = oscRecall(voiceHost.getShow(), event.address, event.value);
    if (target) {
      applyTransportRecall(target, { kind: 'osc', label: event.address, value: event.value });
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

// --- boot -------------------------------------------------------------------

function lanUrls(p: number): string[] {
  const urls: string[] = [];
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${p}`);
    }
  }
  return urls;
}

server.listen(port, () => {
  if (voiceHost) voiceHost.start();
  else host.start();
  console.log(`LEDrums server listening on http://localhost:${port}${VOICE_MODE ? ' [voice engine]' : ''}`);
  for (const url of lanUrls(port)) console.log(`  LAN: ${url}`);
  console.log(`OSC listening on udp:${oscPort}`);
  console.log('Pixel output: set target IP + Arm in the UI');
});

// --- shutdown ---------------------------------------------------------------

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statsTimer);
  if (voiceHost) voiceHost.stop();
  else host.stop();
  oscInput.close();
  for (const ws of clients) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  wss.close();
  server.close();
  // Flush any pending autosave so a clean shutdown never loses the last edit. flush()
  // never rejects (write errors are logged), but guard exit-on-error just in case.
  await autosaver.flush().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
