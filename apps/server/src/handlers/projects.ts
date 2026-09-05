import { listProjectsAsync, loadProjectAsync, saveProjectAsync } from '../projects';
import type { EngineHost } from '../engine-host';
import type { createProjectReplacement } from '../project-replacement';
import { encodeServer, type ClientMessage } from '../ws-protocol';

export interface JsonSink { send(data: string): void }
export interface ProjectHandlerDeps {
  host: EngineHost;
  replacement: Pick<ReturnType<typeof createProjectReplacement>, 'load'>;
}

/** Async control-plane IO. The caller awaits this before admitting the next authored operation. */
export async function handleProjectMessage(msg: ClientMessage, ws: JsonSink, deps: ProjectHandlerDeps): Promise<boolean> {
  if (msg.t === 'loadProject') {
    await deps.replacement.load(await loadProjectAsync(msg.name));
    return true;
  }
  if (msg.t === 'saveProject') {
    await saveProjectAsync(msg.name, deps.host.engine.getProject());
    ws.send(encodeServer({ t: 'projects', names: await listProjectsAsync() }));
    return true;
  }
  if (msg.t === 'listProjects') {
    ws.send(encodeServer({ t: 'projects', names: await listProjectsAsync() }));
    return true;
  }
  return false;
}
