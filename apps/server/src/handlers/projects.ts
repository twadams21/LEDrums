import type { Autosaver } from '../autosave';
import type { EngineHost } from '../engine-host';
import { listProjects, loadProject, saveProject } from '../projects';
import type { VoiceEngineHost } from '../voice-engine-host';
import { encodeServer, type ClientMessage } from '../ws-protocol';

/** Minimal socket surface this handler needs to reply to the requesting client — just the JSON
 * send. Structural so a real `ws` WebSocket (and a test fake) both satisfy it without coupling
 * the handler to `ws`. */
export interface JsonSink {
  send(data: string): void;
}

/** Collaborators the project-IO handler needs from the server wiring. */
export interface ProjectHandlerDeps {
  /** THE authoritative store (S8): a load replaces its project object, and a save reads it. */
  voiceHost: VoiceEngineHost;
  /** The legacy render host, or `null` unless the `LEDRUMS_ENGINE=legacy` opt-out is set (S12
   * deletes it). Only ever RE-POINTED at `voiceHost.getProject()`, never used to compute a
   * mutation — that shared identity is what a load must not break. */
  legacyHost: EngineHost | null;
  autosaver: Autosaver;
  /** Broadcast the full `state` message to all clients (`broadcastJson(stateMessage())`). */
  broadcastState(): void;
  /** Pre-risk backup trigger (#123): take a snapshot BEFORE `loadProject` replaces the live project
   * (a bulk apply that also migrates the loaded file's schema on parse). Returns `true` when the
   * safety snapshot was taken (or backups are disabled — no net to fail) and `false` when the WRITE
   * failed, so the load can refuse fail-closed rather than overwrite live state with no recovery
   * point. Absent = backups disabled (treated as `true`). */
  snapshotPreRisk(): boolean;
}

/**
 * Project IO dispatch (load/save/list) — handled here, not by the reducer. Returns `true`
 * when `msg` was a project message and has been fully handled (the caller should stop);
 * `false` when the caller should keep dispatching.
 */
export function handleProjectMessage(msg: ClientMessage, ws: JsonSink, deps: ProjectHandlerDeps): boolean {
  if (msg.t === 'loadProject') {
    const loaded = loadProject(msg.name);
    // Pre-risk snapshot (#123) — capture current state before the loaded project (schema-migrated on
    // parse) replaces it, so a load that turns out wrong still has a clean state behind it. Fail-
    // closed: if the safety snapshot's WRITE fails, REFUSE the load (overwriting live state with no
    // recovery point is the data-loss path) — surface an error, socket alive, live state untouched.
    if (!deps.snapshotPreRisk()) {
      ws.send(encodeServer({ t: 'error', message: `Backup failed — project "${msg.name}" not loaded (no recovery snapshot)` }));
      return true;
    }
    // S5 LOAD AUTHORITY, now through the sole store (S8): the voice host adopts the loaded document
    // BY REFERENCE (kit, inputMap, output AND the authored composition/transport) and rebuilds
    // geometry. Before S5 only the legacy engine was re-pointed, leaving the live render on the
    // PREVIOUS project's geometry while the `state` broadcast below described the new one.
    deps.voiceHost.adoptProject(loaded);
    // The legacy follower is re-pointed at the SAME object, so identity survives a load.
    deps.legacyHost?.engine.setProject(deps.voiceHost.getProject());
    deps.legacyHost?.reloadOutputSettings();
    deps.broadcastState();
    deps.autosaver.markDirty(); // the loaded project is now the live state — persist it
    return true;
  }
  if (msg.t === 'saveProject') {
    saveProject(msg.name, deps.voiceHost.getProject());
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return true;
  }
  if (msg.t === 'listProjects') {
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return true;
  }
  return false;
}
