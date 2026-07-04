import { describe, expect, it } from 'vitest';
import { reduceBoot, initialBootStatus, type BootStatus } from './boot-reducer';

/* Pure reducer for the desktop boot/update state (S06). No Tauri, no runes — just the
   snapshot+stream merge and the progress/stage transitions the bridge relies on. */

describe('reduceBoot', () => {
  it('applies a boot snapshot without dropping the starting default', () => {
    const next = reduceBoot(initialBootStatus, {
      kind: 'snapshot',
      payload: { stage: 'running', localUrl: 'http://127.0.0.1:4178', tunnelUrl: 'https://x.trycloudflare.com', pin: '481923' },
    });
    expect(next.stage).toBe('running');
    expect(next.localUrl).toBe('http://127.0.0.1:4178');
    expect(next.tunnelUrl).toBe('https://x.trycloudflare.com');
    expect(next.pin).toBe('481923');
    expect(next.progressPct).toBeNull();
  });

  it('keeps sticky url/pin fields when an updating status omits them', () => {
    // Rust rebuilds a fresh BootStatus for update progress (stage+message+progress only) — the
    // reducer must not let those null fields wipe the URL/PIN learned during boot.
    const running: BootStatus = {
      ...initialBootStatus,
      stage: 'running',
      localUrl: 'http://127.0.0.1:4178',
      tunnelUrl: 'https://x.trycloudflare.com',
      pin: '481923',
    };
    const next = reduceBoot(running, {
      kind: 'status',
      payload: { stage: 'updating', message: 'Downloading update… 12%', progressPct: 12, localUrl: null, tunnelUrl: null, pin: null },
    });
    expect(next.stage).toBe('updating');
    expect(next.progressPct).toBe(12);
    expect(next.message).toBe('Downloading update… 12%');
    expect(next.localUrl).toBe('http://127.0.0.1:4178');
    expect(next.tunnelUrl).toBe('https://x.trycloudflare.com');
    expect(next.pin).toBe('481923');
  });

  it('streams progress percentages while updating', () => {
    let state: BootStatus = { ...initialBootStatus, stage: 'running', localUrl: 'http://local' };
    for (const pct of [0, 37, 88, 100]) {
      state = reduceBoot(state, {
        kind: 'status',
        payload: { stage: 'updating', message: `Downloading update… ${pct}%`, progressPct: pct },
      });
      expect(state.stage).toBe('updating');
      expect(state.progressPct).toBe(pct);
    }
    expect(state.localUrl).toBe('http://local');
  });

  it('clears progressPct once the stage leaves updating', () => {
    const updating: BootStatus = { ...initialBootStatus, stage: 'updating', progressPct: 64 };
    expect(reduceBoot(updating, { kind: 'status', payload: { stage: 'error', message: 'download failed' } })).toMatchObject({
      stage: 'error',
      message: 'download failed',
      progressPct: null,
    });
    expect(reduceBoot(updating, { kind: 'status', payload: { stage: 'running' } }).progressPct).toBeNull();
  });

  it('streams download byte counts while updating and clears them when it ends', () => {
    let state: BootStatus = { ...initialBootStatus, stage: 'running' };
    state = reduceBoot(state, {
      kind: 'status',
      payload: { stage: 'updating', progressPct: 45, downloadedBytes: 65_000_000, totalBytes: 144_000_000 },
    });
    expect(state).toMatchObject({ downloadedBytes: 65_000_000, totalBytes: 144_000_000 });
    // Leaving updating clears the byte counts alongside progressPct.
    const done = reduceBoot(state, { kind: 'status', payload: { stage: 'running' } });
    expect(done).toMatchObject({ downloadedBytes: null, totalBytes: null, progressPct: null });
  });

  it('carries the error message on the error stage', () => {
    const next = reduceBoot(initialBootStatus, {
      kind: 'status',
      payload: { stage: 'error', message: 'the server exited unexpectedly' },
    });
    expect(next).toMatchObject({ stage: 'error', message: 'the server exited unexpectedly', progressPct: null });
  });

  it('folds update availability without touching boot fields', () => {
    const running: BootStatus = { ...initialBootStatus, stage: 'running', pin: '123' };
    const avail = reduceBoot(running, { kind: 'update-available', version: '1.4.0' });
    expect(avail).toMatchObject({ stage: 'running', pin: '123', updateAvailable: true, updateVersion: '1.4.0' });
    const cleared = reduceBoot(avail, { kind: 'update-unavailable' });
    expect(cleared).toMatchObject({ updateAvailable: false, updateVersion: null, pin: '123' });
  });

  it('folds update availability arriving on a boot event (Rust startup check)', () => {
    // S07: the native dialog is gone; the Rust startup OTA check publishes availability through the
    // boot event, so the reducer must surface it into updateAvailable/updateVersion for the badge.
    const running: BootStatus = { ...initialBootStatus, stage: 'running', pin: '481923' };
    const next = reduceBoot(running, {
      kind: 'status',
      payload: { updateAvailable: true, updateVersion: '2.0.0' },
    });
    expect(next).toMatchObject({ stage: 'running', pin: '481923', updateAvailable: true, updateVersion: '2.0.0' });
  });

  it('keeps update availability sticky across ordinary boot events', () => {
    const avail: BootStatus = { ...initialBootStatus, stage: 'running', updateAvailable: true, updateVersion: '2.0.0' };
    // A later status that says nothing about updates must not clear the badge.
    const next = reduceBoot(avail, { kind: 'status', payload: { stage: 'running', message: 'still here' } });
    expect(next).toMatchObject({ updateAvailable: true, updateVersion: '2.0.0' });
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze({ ...initialBootStatus });
    expect(() => reduceBoot(frozen, { kind: 'status', payload: { stage: 'running' } })).not.toThrow();
    expect(frozen.stage).toBe('starting');
  });
});
