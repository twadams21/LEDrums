import type { Autosaver } from '../autosave';
import type { EngineHost } from '../engine-host';
import { listProjects, loadProject, saveProject } from '../projects';
import { encodeServer, type ClientMessage } from '../ws-protocol';

/** Minimal socket surface this handler needs to reply to the requesting client — just the JSON
 * send. Structural so a real `ws` WebSocket (and a test fake) both satisfy it without coupling
 * the handler to `ws`. */
export interface JsonSink {
  send(data: string): void;
}

/** Collaborators the project-IO handler needs from the server wiring. */
export interface ProjectHandlerDeps {
  host: EngineHost;
  autosaver: Autosaver;
  /** Broadcast the full `state` message to all clients (`broadcastJson(stateMessage())`). */
  broadcastState(): void;
  /** Pre-risk backup trigger (#123): take a snapshot BEFORE `loadProject` replaces the live project
   * (a bulk apply that also migrates the loaded file's schema on parse). Returns `true` when the
   * safety snapshot was taken (or backups are disabled — no net to fail) and `false` when the WRITE
   * failed, so the load can refuse fail-closed rather than overwrite live state with no recovery
   * point. Absent = backups disabled (treated as `true`). */
  snapshotPreRisk?(): boolean;
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
    // `?? true`: backups absent (disabled) = no net to fail → proceed.
    if ((deps.snapshotPreRisk?.() ?? true) === false) {
      ws.send(encodeServer({ t: 'error', message: `Backup failed — project "${msg.name}" not loaded (no recovery snapshot)` }));
      return true;
    }
    deps.host.engine.setProject(loaded);
    deps.host.reloadOutputSettings();
    deps.broadcastState();
    deps.autosaver.markDirty(); // the loaded project is now the live state — persist it
    return true;
  }
  if (msg.t === 'saveProject') {
    saveProject(msg.name, deps.host.engine.getProject());
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return true;
  }
  if (msg.t === 'listProjects') {
    ws.send(encodeServer({ t: 'projects', names: listProjects() }));
    return true;
  }
  return false;
}
