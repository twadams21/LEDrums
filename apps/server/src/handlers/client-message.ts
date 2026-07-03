import { projectPatchSchema } from '@ledrums/core';
import type { Autosaver } from '../autosave';
import type { ClientRegistry, CloseableSocket } from '../client-registry';
import type { EngineHost } from '../engine-host';
import { applyClientMessage } from '../input-router';
import type { VoiceEngineHost } from '../voice-engine-host';
import { encodeServer, type ClientMessage, type ServerMessage, type ShowLibraryBlob, type SongLibraryBlob } from '../ws-protocol';
import type { MonitorDraft } from '../monitor';
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

function isMidiChannelMessage(msg: ClientMessage): msg is Extract<ClientMessage, { t: 'midi' | 'cc' | 'programChange' }> {
  return msg.t === 'midi' || msg.t === 'cc' || msg.t === 'programChange';
}

/** App-wide MIDI channel filter. null means "omni"; when set, unknown-channel messages are
    dropped rather than bypassing the filter. */
function acceptsMidiChannel(msg: ClientMessage, channel: number | null): boolean {
  if (channel === null || !isMidiChannelMessage(msg)) return true;
  return msg.channel === channel;
}

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

/** A pushed library payload is usable iff it is an object carrying a numeric `version` — the same
    opaque-envelope gate the persistence layer applies. Shared by the show + song library branches. */
function isVersionedBlob(lib: unknown): lib is { version: number; data: unknown } {
  return !!lib && typeof lib === 'object' && typeof (lib as { version?: unknown }).version === 'number';
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
  songLibraryAutosaver: Autosaver;
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
  /** Adopt a pushed song library as the live slot (mirrors {@link setShowLibrary}). */
  setSongLibrary(lib: SongLibraryBlob): void;
  /** Relay a server message to every client EXCEPT `sender` (the live show/song-library relay). */
  relayToOthers(sender: S, msg: ServerMessage): void;
  /** Append a diagnostic event to the shared Monitor stream. */
  monitor?(event: MonitorDraft): void;
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
    songLibraryAutosaver,
    broadcastJson,
    broadcastPresence,
    broadcastState,
    stateMessage,
    setShowLibrary,
    setSongLibrary,
    relayToOthers,
    monitor,
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

    // App-wide MIDI channel filter. Runs before voice-mode recall, zone mapping and the
    // legacy reducer so every MIDI input adapter obeys the same setting.
    if (!acceptsMidiChannel(msg, host.engine.getProject().inputMap.midiChannel)) return;

    // Show-library persistence: the editor pushes its authored library on every change; the server
    // adopts it as the live slot, debounce-autosaves it, AND relays it live to the OTHER clients so
    // viewers follow without a full `state` rebuild. Never echoed to the sender (it is the source);
    // cold-load adopt for a fresh client still happens via the `state` message on (re)connect.
    if (msg.t === 'setShowLibrary') {
      if (isVersionedBlob(msg.library)) {
        const blob = msg.library;
        setShowLibrary(blob);
        showLibraryAutosaver.markDirty();
        monitor?.({
          type: 'persistence',
          direction: 'local',
          source: 'server',
          destination: 'show-library',
          label: 'Show library update accepted',
        });
        relayToOthers(ws, { t: 'showLibrary', library: blob });
      }
      return;
    }

    // Song-library persistence — the song-library counterpart of `setShowLibrary` above, identical
    // in shape (adopt live slot → debounce-autosave → relay to the other clients; cold-load adopt
    // is via `state` on (re)connect). The two libraries persist to distinct named blobs.
    if (msg.t === 'setSongLibrary') {
      if (isVersionedBlob(msg.library)) {
        const blob = msg.library;
        setSongLibrary(blob);
        songLibraryAutosaver.markDirty();
        monitor?.({
          type: 'persistence',
          direction: 'local',
          source: 'server',
          destination: 'song-library',
          label: 'Song library update accepted',
        });
        relayToOthers(ws, { t: 'songLibrary', library: blob });
      }
      return;
    }

    // Bulk device re-rig (S45): a pasted `patch` ClipDoc's Project slices, applied as ONE message.
    // Schema-validate the WHOLE payload FIRST — an invalid patch is a user-visible `error` reply to
    // the sender with ZERO state touched (AGENTS.md: validate before any state, no partial apply).
    // On accept, apply once: the legacy engine adopts the merged project (a single kit reload, never
    // a granular setKit*/setInputMap/setOutput replay), the voice host bulk-adopts the same slices,
    // then persist + broadcast fresh `state`. Authored composition/setlist are never touched.
    if (msg.t === 'setProject') {
      const parsed = projectPatchSchema.safeParse(msg.patch);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.join('.') || 'patch';
        ws.send(encodeServer({ t: 'error', message: `Invalid patch: ${where} — ${issue?.message ?? 'validation failed'}` }));
        monitor?.({
          type: 'error',
          direction: 'in',
          source: 'client',
          destination: 'project',
          label: 'Patch rejected (invalid)',
          detail: `${where}: ${issue?.message ?? 'validation failed'}`,
        });
        return;
      }
      const patch = parsed.data;
      const cur = host.engine.getProject();
      host.engine.setProject({
        ...cur,
        name: patch.name ?? cur.name,
        kit: patch.kit,
        inputMap: patch.inputMap,
        output: patch.output,
      });
      host.reloadOutputSettings();
      if (voiceHost) voiceHost.adoptPatch(patch);
      monitor?.({
        type: 'system',
        direction: 'in',
        source: 'client',
        destination: 'project',
        label: 'Patch applied',
        detail: `${patch.kit.drums.length} drums${patch.name ? ` · ${patch.name}` : ''}`,
      });
      broadcastJson(stateMessage());
      autosaver.markDirty();
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
      const midiMeta = msg.t === 'midi' ? { note: msg.note, channel: msg.channel } : {};
      broadcastJson({ t: 'input', kind: result.monitor.kind, label: result.monitor.label, value: result.monitor.value, ...midiMeta });
    }
  };
}
