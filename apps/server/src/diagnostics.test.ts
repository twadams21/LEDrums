import { describe, expect, it } from 'vitest';
import { startupDiagnostics, type StartupDiagnosticsInput } from './diagnostics';

function input(overrides: Partial<StartupDiagnosticsInput> = {}): StartupDiagnosticsInput {
  return {
    voiceMode: true,
    port: 5174,
    oscPort: 9000,
    oscHosts: ['192.168.1.20'],
    webRoot: '/dist',
    webRootExists: true,
    project: { name: 'default.local', path: '/projects/default.local.json', source: 'file' },
    showLibrary: { path: '/projects/default.shows.local.json', source: 'loaded' },
    songLibrary: { path: '/projects/default.songs.local.json', source: 'absent' },
    tunnel: { enabled: true, url: null },
    pinRequired: true,
    hostTokenPresent: true,
    ...overrides,
  };
}

describe('startupDiagnostics', () => {
  it('reports voice vs legacy mode', () => {
    expect(startupDiagnostics(input())[0]?.label).toContain('voice');
    expect(startupDiagnostics(input({ voiceMode: false }))[0]?.label).toContain('legacy');
  });

  it('represents project and show-library sources', () => {
    const events = startupDiagnostics(input({
      project: { name: 'default.local', path: '/p/default.local.json', source: 'seed' },
      showLibrary: { path: '/p/default.shows.local.json', source: 'invalid' },
      songLibrary: { path: '/p/default.songs.local.json', source: 'loaded' },
    }));

    expect(events.find((e) => e.destination === 'project')).toMatchObject({ label: 'Project loaded from seed', detail: 'default.local; /p/default.local.json' });
    expect(events.find((e) => e.destination === 'show-library')).toMatchObject({ label: 'Show library invalid', detail: '/p/default.shows.local.json' });
    expect(events.find((e) => e.destination === 'song-library')).toMatchObject({ label: 'Song library loaded', detail: '/p/default.songs.local.json' });
  });

  it('tells the user the exact host:port to send OSC to', () => {
    const entry = startupDiagnostics(input({ oscHosts: ['192.168.1.20', '10.0.0.5'] })).find(
      (e) => e.destination === 'osc-input',
    );
    expect(entry).toMatchObject({
      label: 'OSC input on udp:9000',
      detail: 'send OSC to 192.168.1.20:9000 or 10.0.0.5:9000',
    });
  });

  it('falls back to loopback guidance when the machine has no LAN address', () => {
    const entry = startupDiagnostics(input({ oscHosts: [] })).find((e) => e.destination === 'osc-input');
    expect(entry?.detail).toBe('no LAN address detected; send OSC to 127.0.0.1:9000');
  });

  it('does not include secret values in labels or details', () => {
    const secretPin = '123456';
    const secretToken = 'host-token-secret';
    const text = startupDiagnostics(input()).map((e) => `${e.label} ${e.detail ?? ''}`).join('\n');

    expect(text).not.toContain(secretPin);
    expect(text).not.toContain(secretToken);
    expect(text).toContain('pinRequired=true');
    expect(text).toContain('hostTokenPresent=true');
  });
});
