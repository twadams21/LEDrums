import type { MonitorEvent } from './ws-protocol';

type MonitorDraft = Omit<MonitorEvent, 'id' | 'time'>;

export interface StartupDiagnosticsInput {
  voiceMode: boolean;
  port: number;
  oscPort: number;
  webRoot: string;
  webRootExists: boolean;
  project: { name: string; path: string; source: 'seed' | 'file' };
  showLibrary: { path: string; source: 'absent' | 'loaded' | 'invalid' };
  songLibrary: { path: string; source: 'absent' | 'loaded' | 'invalid' };
  tunnel: { enabled: boolean; url: string | null };
  pinRequired: boolean;
  hostTokenPresent: boolean;
}

export function startupDiagnostics(input: StartupDiagnosticsInput): MonitorDraft[] {
  return [
    {
      type: 'system',
      direction: 'local',
      source: 'server',
      label: `Server started in ${input.voiceMode ? 'voice' : 'legacy'} mode`,
      detail: `http=:${input.port}; osc=:${input.oscPort}`,
    },
    {
      type: 'persistence',
      direction: 'local',
      source: 'server',
      destination: 'project',
      label: `Project loaded from ${input.project.source}`,
      detail: `${input.project.name}; ${input.project.path}`,
    },
    {
      type: 'persistence',
      direction: 'local',
      source: 'server',
      destination: 'show-library',
      label: `Show library ${input.showLibrary.source}`,
      detail: input.showLibrary.path,
    },
    {
      type: 'persistence',
      direction: 'local',
      source: 'server',
      destination: 'song-library',
      label: `Song library ${input.songLibrary.source}`,
      detail: input.songLibrary.path,
    },
    {
      type: 'system',
      direction: 'local',
      source: 'server',
      destination: 'web',
      label: input.webRootExists ? 'Web root ready' : 'Web root missing; serving placeholder',
      detail: input.webRoot,
    },
    {
      type: 'system',
      direction: 'local',
      source: 'server',
      destination: 'remote-access',
      label: input.tunnel.enabled ? 'Tunnel enabled' : 'Tunnel disabled',
      detail: `pinRequired=${input.pinRequired}; hostTokenPresent=${input.hostTokenPresent}`,
    },
  ];
}
