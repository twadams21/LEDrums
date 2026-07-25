import { describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { EngineHost } from '../engine-host';
import type { Autosaver } from '../autosave';
import type { ClientMessage, ServerMessage } from '../ws-protocol';
import { handleProjectMessage, type JsonSink } from './projects';

// `loadProject` reads from disk; stub it so these tests exercise the HANDLER seam (the pre-risk
// fail-closed gate) rather than project IO. A valid Project is returned so control reaches the gate.
vi.mock('../projects', () => ({
  loadProject: vi.fn(() => defaultProject()),
  listProjects: vi.fn(() => ['a', 'b']),
  saveProject: vi.fn(),
}));

function fakeAutosaver(): Autosaver {
  return { markDirty: vi.fn(), flush: () => Promise.resolve(), dispose: () => {} };
}

/** A JSON sink that records what the handler replied to the requesting client. */
function fakeSink() {
  const sent: ServerMessage[] = [];
  const sink: JsonSink = { send: (data) => sent.push(JSON.parse(data) as ServerMessage) };
  return { sink, sent };
}

function harness(snapshotPreRisk?: () => boolean) {
  const host = new EngineHost(defaultProject());
  const autosaver = fakeAutosaver();
  const broadcastState = vi.fn();
  const { sink, sent } = fakeSink();
  const deps = { host, autosaver, broadcastState, snapshotPreRisk };
  const run = (msg: ClientMessage): boolean => handleProjectMessage(msg, sink, deps);
  return { host, autosaver, broadcastState, sent, run };
}

describe('handleProjectMessage — loadProject pre-risk fail-closed (#138 C1)', () => {
  it('loads the project when the pre-risk snapshot is taken (backups present, write ok)', () => {
    const snapshotPreRisk = vi.fn(() => true);
    const { host, autosaver, broadcastState, run } = harness(snapshotPreRisk);
    const before = host.engine.getProject();

    const handled = run({ t: 'loadProject', name: 'p' });

    expect(handled).toBe(true);
    expect(snapshotPreRisk).toHaveBeenCalledTimes(1);
    expect(host.engine.getProject()).not.toBe(before); // the loaded project replaced live state
    expect(broadcastState).toHaveBeenCalledTimes(1);
    expect(autosaver.markDirty).toHaveBeenCalledTimes(1);
  });

  it('loads the project when backups are disabled (no snapshotPreRisk — no net to fail)', () => {
    const { host, broadcastState, run } = harness(undefined);
    const before = host.engine.getProject();

    run({ t: 'loadProject', name: 'p' });

    expect(host.engine.getProject()).not.toBe(before);
    expect(broadcastState).toHaveBeenCalledTimes(1);
  });

  it('REFUSES the load and leaves live state untouched when the pre-risk snapshot fails', () => {
    const snapshotPreRisk = vi.fn(() => false); // safety snapshot WRITE failed
    const { host, autosaver, broadcastState, sent, run } = harness(snapshotPreRisk);
    const before = host.engine.getProject();

    const handled = run({ t: 'loadProject', name: 'p' });

    expect(handled).toBe(true); // message consumed (a visible error was sent), not passed through
    expect(snapshotPreRisk).toHaveBeenCalledTimes(1);
    expect(host.engine.getProject()).toBe(before); // live state untouched — no setProject
    expect(broadcastState).not.toHaveBeenCalled();
    expect(autosaver.markDirty).not.toHaveBeenCalled();
    const err = sent.find((m) => m.t === 'error');
    expect(err).toMatchObject({ t: 'error', message: expect.stringContaining('Backup failed') });
  });
});
