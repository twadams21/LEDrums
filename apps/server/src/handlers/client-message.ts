import type { Autosaver } from '../autosave';
import type { ClientRegistry, CloseableSocket } from '../client-registry';
import type { EngineHost } from '../engine-host';
import { applyClientMessage } from '../input-router';
import type { VoiceEngineHost } from '../voice-engine-host';
import type { ClientMessage, ServerMessage, ShowLibraryBlob } from '../ws-protocol';
import { handleProjectMessage, type JsonSink } from './projects';
import { handleVoiceInput, propagateToVoiceHost } from './voice-input';

// ---------------------------------------------------------------------------
// Read-only gating policy (S2)
// ---------------------------------------------------------------------------

/**
 * Engine inputs come from the drummer's LOCAL hardware (MIDI notes, OSC, transport recalls) and
 * always drive the engine regardless of who holds the editor slot — they are NOT authoring. The
 * editor lock never gates them, so the drummer can keep playing while someone else edits.
 */
const ENGINE_INPUTS: ReadonlySet<ClientMessage['t']> = new Set([
  'midi',
  'osc',
  'cc',
  'programChange',
  'key',
  'recallSection',
]);

/**
 * Non-authoring messages any client may send: pure reads (`listProjects`) and the role-claim
 * (`takeover`). These mutate no shared authored state, so they bypass the editor gate.
 */
const UNGATED_NON_INPUTS: ReadonlySet<ClientMessage['t']> = new Set(['listProjects', 'takeover']);

/**
 * Whether `t` is an AUTHORING mutation that only the editor may apply (S2 read-only policy).
 * Deny-by-default: anything that is neither an engine input nor a pure read requires the editor
 * slot — so a NEW authoring message added to the protocol later is gated automatically rather
 * than silently slipping through.
 */
export function requiresEditor(t: ClientMessage['t']): boolean {
  return !ENGINE_INPUTS.has(t) && !UNGATED_NON_INPUTS.has(t);
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/** The socket surface the message handler needs: closeable (for the registry) + JSON send (so
 * the project-IO handler can reply to the requesting client). A real `ws` WebSocket satisfies it. */
export interface HandlerSocket extends CloseableSocket, JsonSink {}

/** Collaborators the WS message handler needs from the server wiring. Pushing the socket-iterating
 * broadcasts behind callbacks keeps the handler free of `ws` plumbing (and trivially testable with
 * fake sockets). */
export interface ClientMessageDeps<S extends HandlerSocket> {
  clients: ClientRegistry<S>;
  host: EngineHost;
  /** The voice-bus host, or `null` in legacy mode. */
  voiceHost: VoiceEngineHost | null;
  autosaver: Autosaver;
  showLibraryAutosaver: Autosaver;
  /** Broadcast a JSON message to every client. */
  broadcastJson(msg: ServerMessage): void;
  /** Re-broadcast `presence` to every client (each gets its own `youAreEditor`). */
  broadcastPresence(): void;
  /** Broadcast the full `state` message to every client (`broadcastJson(stateMessage())`). */
  broadcastState(): void;
  /** Build the full `state` message reflecting the current engine/project. */
  stateMessage(): ServerMessage;
  /** Adopt a pushed show library as the live slot (owned by the server wiring). */
  setShowLibrary(lib: ShowLibraryBlob): void;
  /** Relay a server message to every client EXCEPT `sender` (the live showLibrary relay). */
  relayToOthers(sender: S, msg: ServerMessage): void;
}

/**
 * Build the WS client→server message handler (S1 spine + S2 takeover/read-only gating).
 *
 * Dispatch order:
 *  1. `takeover` — any client may claim the editor slot; the prior editor drops to viewer and
 *     `presence` is re-broadcast so every client converges (last-press-wins).
 *  2. Read-only gate — every authoring mutation is rejected (silent no-op) unless the sender is
 *     the editor; engine inputs and pure reads always pass ({@link requiresEditor}).
 *  3. Project IO → show-library push/relay → voice-mode inputs → the legacy reducer, exactly as
 *     the S1 server did.
 */
export function createClientMessageHandler<S extends HandlerSocket>(
  deps: ClientMessageDeps<S>,
): (msg: ClientMessage, ws: S) => void {
  const {
    clients,
    host,
    voiceHost,
    autosaver,
    showLibraryAutosaver,
    broadcastJson,
    broadcastPresence,
    broadcastState,
    stateMessage,
    setShowLibrary,
    relayToOthers,
  } = deps;
  const voiceDeps = { voiceHost, broadcastJson };

  return function handleClientMessage(msg: ClientMessage, ws: S): void {
    // (1) Explicit editor hand-off (S2). Any client may take over; broadcast the new presence so
    // every client's role + indicator updates. A no-op (`takeover` on the current editor) still
    // re-broadcasts — harmless and keeps headcount fresh.
    if (msg.t === 'takeover') {
      clients.takeover(ws);
      broadcastPresence();
      return;
    }

    // (2) Read-only gating (S2). Authoring mutations are editor-only; a non-editor's attempt is a
    // silent no-op (the viewer's UI already disables the affordance — this is the authoritative
    // server backstop). Engine inputs (the drummer's hardware) + pure reads always pass.
    if (requiresEditor(msg.t) && !clients.canMutate(ws)) return;

    // Project IO (load/save/list) is handled here, not by the reducer.
    if (handleProjectMessage(msg, ws, { host, autosaver, broadcastState })) return;

    // Show-library persistence: the editor pushes its authored library on every change; the server
    // adopts it as the live slot, debounce-autosaves it, AND relays it live to the OTHER clients so
    // viewers follow without a full `state` rebuild. Never echoed to the sender (it is the source);
    // cold-load adopt for a fresh client still happens via the `state` message on (re)connect.
    if (msg.t === 'setShowLibrary') {
      const lib = msg.library;
      if (lib && typeof lib === 'object' && typeof (lib as { version?: unknown }).version === 'number') {
        const blob = lib as ShowLibraryBlob;
        setShowLibrary(blob);
        showLibraryAutosaver.markDirty();
        relayToOthers(ws, { t: 'showLibrary', library: blob });
      }
      return;
    }

    // Voice-mode inputs (recalls, native pad hits, raw midi/osc). In legacy mode the voice-only
    // types are consumed as no-ops; midi/osc fall through to the reducer below.
    if (handleVoiceInput(msg, voiceDeps)) return;

    // midi/osc are inputs — stamp wall time for latency before the reducer enqueues.
    if (msg.t === 'midi' || msg.t === 'osc') host.markInput();

    const result = applyClientMessage(host.engine, msg, host.engineTimeMs);

    // Voice mode: the legacy reducer above mutated the shared project; propagate kit/output/
    // input-map edits to the voice host (which owns the live render + output).
    if (voiceHost) propagateToVoiceHost(voiceHost, msg);

    // Output settings or geometry changed → re-apply output + send fresh state. (setKitOutputs has
    // no legacy reducer case, so it never sets result.structural; mark dirty here so the output-
    // topology reorder is persisted too.)
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
  };
}
