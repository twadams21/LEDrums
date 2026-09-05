import { describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { EngineHost } from '../engine-host';
import { createProjectReplacement } from '../project-replacement';
import { handleProjectMessage } from './projects';

vi.mock('../projects', () => ({
  loadProjectAsync: vi.fn(async () => defaultProject()),
  listProjectsAsync: vi.fn(async () => ['a', 'b']),
  saveProjectAsync: vi.fn(async () => {}),
}));

function harness(safe = true) {
  const host = new EngineHost(defaultProject());
  const broadcastState = vi.fn();
  const safetySnapshot = vi.fn(async () => safe);
  const persist = vi.fn(async () => {});
  const replacement = createProjectReplacement({ host, voiceHost: null,
    readCurrent: () => ({ project: host.engine.getProject(), showLibrary: null, songLibrary: null }),
    safetySnapshot, persist, flushAutosaves: async () => {}, commitLibraries: () => {}, broadcastState });
  const send = vi.fn();
  return { host, broadcastState, safetySnapshot, persist, send,
    run: () => handleProjectMessage({ t: 'loadProject', name: 'p' }, { send }, { host, replacement }) };
}

describe('async project IO delegates to the authoritative replacement', () => {
  it('awaits the safety snapshot and emits one state sync', async () => {
    const h = harness();
    const before = h.host.engine;
    expect(await h.run()).toBe(true);
    expect(h.host.engine).not.toBe(before);
    expect(h.safetySnapshot).toHaveBeenCalledOnce();
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.broadcastState).toHaveBeenCalledOnce();
  });
  it('rejects without live/disk mutation when backup fails', async () => {
    const h = harness(false);
    const before = h.host.engine;
    await expect(h.run()).rejects.toThrow('Backup failed');
    expect(h.host.engine).toBe(before);
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.broadcastState).not.toHaveBeenCalled();
  });
});
