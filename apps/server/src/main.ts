import { createServer } from 'node:http';
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
  parseSectionRecallAddress,
} from './input-router';
import { listProjects, loadProject, projectExists, saveProjectAsync } from './projects';
import { loadShowLibrary, saveShowLibraryAsync, type ShowLibraryBlob } from './show-library';
import { createAutosaver } from './autosave';
import { ClientRegistry } from './client-registry';
import { serveStatic } from './static-host';
import { boot } from './boot';
import { handleProjectMessage } from './handlers/projects';
import { applyTransportRecall, handleVoiceInput, propagateToVoiceHost } from './handlers/voice-input';
import {
  decodeClient,
  effectSpecs,
  encodeServer,
  serializeModel,
  type ClientMessage,
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

const server = createServer((req, res) => {
  serveStatic(req, res);
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
  };
}

if (voiceHost) voiceHost.onFrame = (rgb) => broadcastBinary(rgb);
else host.onFrame = (rgb) => broadcastBinary(rgb);

wss.on('connection', (ws) => {
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

// Shared collaborators handed to the extracted message handlers. `broadcastState` and the
// voice deps capture the wiring closures so the handlers stay free of module-level state.
const broadcastState = (): void => broadcastJson(stateMessage());
const voiceDeps = { voiceHost, broadcastJson };

function handleClientMessage(msg: ClientMessage, ws: WebSocket): void {
  // Editor-only authoring (S1): the authored Show + show library may be set ONLY by the current
  // editor — a viewer's pushes (e.g. its connect-time handshake, or an adopted-state echo) are
  // dropped so they can't clobber the shared authored content. Broader read-only gating is S2.
  if ((msg.t === 'setShow' || msg.t === 'setShowLibrary') && !clients.canMutate(ws)) return;

  // Project IO (load/save/list) is handled here, not by the reducer.
  if (handleProjectMessage(msg, ws, { host, autosaver, broadcastState })) return;

  // Show-library persistence is mode-independent (authored content, not an engine input): the
  // editor pushes its authored library on every change; the server adopts it as the live slot,
  // debounce-autosaves it, AND relays it live to the OTHER clients so viewers follow without a full
  // `state` rebuild. Never echoed to the sender (it is already the source); cold-load adopt for a
  // fresh client still happens via the `state` message on (re)connect.
  if (msg.t === 'setShowLibrary') {
    const lib = msg.library;
    if (lib && typeof lib === 'object' && typeof (lib as { version?: unknown }).version === 'number') {
      liveShowLibrary = lib as ShowLibraryBlob;
      showLibraryAutosaver.markDirty();
      const relay = encodeServer({ t: 'showLibrary', library: liveShowLibrary });
      for (const other of clients) {
        if (other !== ws && other.readyState === other.OPEN) other.send(relay);
      }
    }
    return;
  }

  // Voice-mode inputs (recalls, native pad hits, raw midi/osc). In legacy mode the
  // voice-only types are consumed as no-ops; midi/osc fall through to the reducer below.
  if (handleVoiceInput(msg, voiceDeps)) return;

  // midi/osc are inputs — stamp wall time for latency before the reducer enqueues.
  if (msg.t === 'midi' || msg.t === 'osc') host.markInput();

  const result = applyClientMessage(host.engine, msg, host.engineTimeMs);

  // Voice mode: the legacy reducer above mutated the shared project; propagate kit/output/
  // input-map edits to the voice host (which owns the live render + output).
  if (voiceHost) propagateToVoiceHost(voiceHost, msg);

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
    // A section-recall address (e.g. from a show-control system) is always consumed by the
    // recall handler before the zone-map, exactly like the WS osc path; anything else is a
    // normal OSC input.
    if (parseSectionRecallAddress(event.address) !== null) {
      const target = oscRecall(voiceHost.getShow(), event.address, event.value);
      if (target) applyTransportRecall(voiceDeps, target, { kind: 'osc', label: event.address, value: event.value });
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
});
