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
import { applyClientMessage, oscToEvent } from './input-router';
import { listProjects, loadProject, projectExists, saveProject } from './projects';
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

function initialProject(): Project {
  // Seed-from-core: with no saved 'default', the default project is computed from
  // the canonical in-code definition (defaultProject → DEFAULT_KIT), so there is no
  // hand-edited file to drift from the engine/lab kit. A saved 'default' (if the
  // user saved one) is loaded + integrity-checked, and fails loudly on dangling refs.
  if (!projectExists('default')) return defaultProject();
  return loadProject('default');
}

const project0 = initialProject();
const host = new EngineHost(project0);
/** Voice-bus host, only constructed in voice mode. It owns the live render + output;
 * the legacy `host` still backs the `state` message and the structural reducer so the
 * existing UI/project surface keeps working. */
const voiceHost = VOICE_MODE ? new VoiceEngineHost(project0) : null;

// --- HTTP + static + WS -----------------------------------------------------

const server = createServer((req, res) => {
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: WS_PATH });
const clients = new Set<WebSocket>();

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

/** Build the full `state` message reflecting the current engine/project. */
function stateMessage(): ServerMessage {
  return {
    t: 'state',
    project: host.engine.getProject(),
    model: serializeModel(host.engine.getModel()),
    effects: effectSpecs(),
    projects: listProjects(),
    output: (voiceHost ?? host).getOutputStatus(),
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);

wss.on('connection', (ws) => {
  clients.add(ws);
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

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

type ClientMessage = ReturnType<typeof decodeClient>;

function handleClientMessage(msg: ClientMessage, ws: WebSocket): void {
  // Project IO is handled here, not by the reducer.
  if (msg.t === 'loadProject') {
    const loaded = loadProject(msg.name);
    host.engine.setProject(loaded);
    host.reloadOutputSettings();
    broadcastJson(stateMessage());
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
      voiceHost.applyInput({ kind: 'osc', address: msg.address, value: msg.value });
      broadcastJson({ t: 'input', kind: 'osc', label: msg.address, value: msg.value });
      return;
    }
  } else if (msg.t === 'setShow' || msg.t === 'key' || msg.t === 'recallSection') {
    // These only apply to the voice engine; ignore in legacy mode.
    return;
  }

  // midi/osc are inputs — stamp wall time for latency before the reducer enqueues.
  if (msg.t === 'midi' || msg.t === 'osc') host.markInput();

  const result = applyClientMessage(host.engine, msg, host.engineTimeMs);

  // Output settings or geometry changed → re-apply output + send fresh state.
  if (msg.t === 'setOutput' || msg.t === 'setKitTransform') {
    host.reloadOutputSettings();
    broadcastJson(stateMessage());
    return;
  }

  if (result.structural) {
    broadcastJson(stateMessage());
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
function shutdown(): void {
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
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
