import type { WebSocket } from 'ws';
import type { Autosaver } from '../autosave';
import type { EngineHost } from '../engine-host';
import { listProjects, loadProject, saveProject } from '../projects';
import { encodeServer, type ClientMessage } from '../ws-protocol';

/** Collaborators the project-IO handler needs from the server wiring. */
export interface ProjectHandlerDeps {
  host: EngineHost;
  autosaver: Autosaver;
  /** Broadcast the full `state` message to all clients (`broadcastJson(stateMessage())`). */
  broadcastState(): void;
}

/**
 * Project IO dispatch (load/save/list) — handled here, not by the reducer. Returns `true`
 * when `msg` was a project message and has been fully handled (the caller should stop);
 * `false` when the caller should keep dispatching.
 */
export function handleProjectMessage(msg: ClientMessage, ws: WebSocket, deps: ProjectHandlerDeps): boolean {
  if (msg.t === 'loadProject') {
    const loaded = loadProject(msg.name);
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
