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
import { applyClientMessage, oscToEvent } from './input-router';
import { listProjects, loadProject, saveProject } from './projects';
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

// --- project + host ---------------------------------------------------------

function initialProject(): Project {
  try {
    return loadProject('default');
  } catch {
    return defaultProject();
  }
}

const host = new EngineHost(initialProject());

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
    output: host.getOutputStatus(),
  };
}

host.onFrame = (rgb) => broadcastBinary(rgb);

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
  host.markInput();
  host.engine.applyEvent(event);
  broadcastJson({ t: 'input', kind: 'osc', label: event.address, value: event.value });
});

// --- periodic stats ---------------------------------------------------------

const statsTimer = setInterval(() => {
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
  host.start();
  console.log(`LEDrums server listening on http://localhost:${port}`);
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
  host.stop();
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
