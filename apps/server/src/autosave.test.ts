import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { createAutosaver } from './autosave';
import { loadProject, projectExists, saveProjectAsync } from './projects';

describe('createAutosaver (debounced)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces a burst of edits into a single debounced write', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosaver(save, 400);
    a.markDirty();
    a.markDirty();
    a.markDirty();
    expect(save).not.toHaveBeenCalled(); // debounced — nothing yet
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1); // one write for the whole burst
    a.dispose();
  });

  it('resets the debounce window on each edit (true debounce)', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosaver(save, 400);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    a.markDirty(); // resets the window
    await vi.advanceTimersByTimeAsync(300); // 300ms since the last edit — not yet
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100); // now 400ms since the last edit
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('flush() writes immediately and resolves when durable', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosaver(save, 10_000);
    a.markDirty();
    await a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('flush() with nothing pending is a no-op', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosaver(save, 400);
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.dispose();
  });

  it('stays dirty and retries after a failed write', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = createAutosaver(save, 10_000);
    a.markDirty();
    await a.flush(); // first attempt rejects — swallowed, stays dirty
    expect(save).toHaveBeenCalledTimes(1);
    await a.flush(); // still dirty → retries, succeeds
    expect(save).toHaveBeenCalledTimes(2);
    a.dispose();
  });

  it('serializes writes — a second flush never overlaps the first', async () => {
    let active = 0;
    let overlapped = false;
    const save = vi.fn().mockImplementation(async () => {
      active++;
      if (active > 1) overlapped = true;
      await Promise.resolve();
      active--;
    });
    const a = createAutosaver(save, 10_000);
    a.markDirty();
    const f1 = a.flush();
    a.markDirty();
    const f2 = a.flush();
    await Promise.all([f1, f2]);
    expect(overlapped).toBe(false);
    a.dispose();
  });

  // End-to-end: a marked-dirty mutation is debounced, then written atomically, and a
  // reload restores it — the crux of live persistence.
  it('persists a mutation that a reload restores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledrums-autosave-'));
    try {
      const project = defaultProject();
      const a = createAutosaver(() => saveProjectAsync('live', project, dir), 10_000);
      project.output.host = '10.0.0.42';
      project.output.priority = 150;
      a.markDirty();
      expect(projectExists('live', dir)).toBe(false); // debounced (10s) — not yet on disk
      await a.flush(); // force the write deterministically
      expect(projectExists('live', dir)).toBe(true);

      const reloaded = loadProject('live', dir);
      expect(reloaded.output.host).toBe('10.0.0.42');
      expect(reloaded.output.priority).toBe(150);
      a.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
