import { describe, expect, it, vi } from 'vitest';
import { voice } from '@ledrums/core';
import { AUDIO_INPUT_STORAGE_KEY, AudioController } from './audio-controller.svelte';
import { AUDIO_FEATURE_INTERVAL_MS, type AudioCaptureDeps, type AudioContextLike, type MediaStreamLike, type TrackLike } from '../audio/capture';

/* The controller between the settings panel and the capture session: ownership (viewers never
   capture), local preference persistence (device id + analysis settings, never show data), and
   the forwarding of every frame — including the zero on stop — to the store. */

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

function fakeDeps(): { deps: AudioCaptureDeps; timers: Map<unknown, () => void>; tracks: TrackLike[]; contexts: AudioContextLike[]; tick(): void } {
  const timers = new Map<unknown, () => void>();
  const tracks: TrackLike[] = [];
  const contexts: AudioContextLike[] = [];
  let n = 1;
  const deps: AudioCaptureDeps = {
    support: { ok: true },
    getUserMedia: async () => {
      const track: TrackLike = { readyState: 'live', label: 'Loopback', stop: vi.fn(), addEventListener() {}, removeEventListener() {} };
      tracks.push(track);
      const stream: MediaStreamLike = { getAudioTracks: () => [track] };
      return stream;
    },
    enumerateInputs: async () => [{ id: 'dev-1', label: 'Loopback' }, { id: 'dev-2', label: '' }],
    createContext: () => {
      const ctx: AudioContextLike = {
        sampleRate: 48000,
        state: 'running',
        resume: async () => {},
        close: async () => {},
        createAnalyser: () => ({
          fftSize: 0, smoothingTimeConstant: 0,
          getFloatTimeDomainData: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * 100 * i) / 48000); },
          getFloatFrequencyData: (a) => { a.fill(Number.NEGATIVE_INFINITY); a[4] = -10; },
          disconnect() {},
        }),
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        addEventListener() {},
        removeEventListener() {},
      };
      contexts.push(ctx);
      return ctx;
    },
    setInterval: (fn) => { const h = n++; timers.set(h, fn); return h; },
    clearInterval: (h) => { timers.delete(h); },
    now: () => n * AUDIO_FEATURE_INTERVAL_MS,
    onDeviceChange: () => () => {},
  };
  return { deps, timers, tracks, contexts, tick: () => { n++; for (const fn of [...timers.values()]) fn(); } };
}

describe('AudioController', () => {
  it('starts only for an editor/host: a viewer is refused and never touches the input', async () => {
    const f = fakeDeps();
    const frames: voice.AudioFeatureFrame[] = [];
    const c = new AudioController({ isViewer: () => true, onFrame: (fr) => frames.push(fr), deps: f.deps, storage: null });
    await c.start();
    expect(c.running).toBe(false);
    expect(c.status).toBe('idle');
    expect(f.tracks).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it('forwards analysed frames while running and one zero frame on stop', async () => {
    const f = fakeDeps();
    const frames: voice.AudioFeatureFrame[] = [];
    const c = new AudioController({ isViewer: () => false, onFrame: (fr) => frames.push(fr), deps: f.deps, storage: null });
    await c.start();
    expect(c.status).toBe('running');
    expect(c.trackLabel).toBe('Loopback');
    f.tick();
    f.tick();
    expect(frames.length).toBe(2);
    expect(frames.at(-1)!.level).toBeGreaterThan(0);
    expect(c.meter.level).toBe(frames.at(-1)!.level);
    c.stop();
    expect(frames.at(-1)).toEqual(voice.ZERO_AUDIO_FRAME);
    expect(c.meter).toEqual(voice.ZERO_AUDIO_FRAME);
    expect(c.status).toBe('stopped');
    expect(f.timers.size).toBe(0);
  });

  it('releases capture when this client drops to viewer (ownership follows the editor slot)', async () => {
    const f = fakeDeps();
    let viewer = false;
    const c = new AudioController({ isViewer: () => viewer, onFrame: () => {}, deps: f.deps, storage: null });
    await c.start();
    c.enforceOwnership(false);
    expect(c.running).toBe(true);
    viewer = true;
    c.enforceOwnership(true);
    expect(c.running).toBe(false);
    expect(c.status).toBe('stopped');
  });

  it('persists device + analysis settings locally and restores them, sanitised', () => {
    const storage = new MemStorage();
    const f = fakeDeps();
    const a = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: f.deps, storage });
    a.setDevice('dev-1');
    a.setSettings({ gain: 2.5, noiseFloorDb: -48, attackMs: 30, releaseMs: 9999 });
    const saved = JSON.parse(storage.getItem(AUDIO_INPUT_STORAGE_KEY)!);
    expect(saved).toEqual({ deviceId: 'dev-1', gain: 2.5, noiseFloorDb: -48, attackMs: 30, releaseMs: 1000 });
    const b = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: f.deps, storage });
    expect(b.deviceId).toBe('dev-1');
    expect(b.settings).toEqual({ gain: 2.5, noiseFloorDb: -48, attackMs: 30, releaseMs: 1000 });
  });

  it('tolerates corrupt or throwing storage', () => {
    const storage = new MemStorage();
    storage.setItem(AUDIO_INPUT_STORAGE_KEY, '{not json');
    const c = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: fakeDeps().deps, storage });
    expect(c.deviceId).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const d = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: fakeDeps().deps, storage: throwing });
    expect(() => d.setSettings({ gain: 2 })).not.toThrow();
    expect(d.settings.gain).toBe(2);
  });

  it('switching device while running restarts on the new input; refreshDevices lists inputs', async () => {
    const f = fakeDeps();
    const c = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: f.deps, storage: null });
    await c.start();
    c.setDevice('dev-2');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.tracks).toHaveLength(2);
    expect((f.tracks[0]!.stop as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(c.running).toBe(true);
    await c.refreshDevices();
    expect(c.devices.map((d) => d.id)).toEqual(['dev-1', 'dev-2']);
  });

  it('dispose stops capture and the synthetic preview never opens an input', async () => {
    const f = fakeDeps();
    const c = new AudioController({ isViewer: () => false, onFrame: () => {}, deps: f.deps, storage: null });
    c.previewSynthetic('running', { level: 0.5, bass: 2, mids: -1, highs: 0.1 });
    expect(c.status).toBe('running');
    expect(c.meter).toEqual({ level: 0.5, bass: 1, mids: 0, highs: 0.1 });
    expect(f.tracks).toHaveLength(0);
    await c.start();
    expect(f.tracks).toHaveLength(1);
    c.dispose();
    expect(c.running).toBe(false);
    await c.start(); // disposed: refused
    expect(f.tracks).toHaveLength(1);
  });

  it('reports an unsupported runtime without ever calling getUserMedia', async () => {
    const f = fakeDeps();
    const deps: AudioCaptureDeps = { ...f.deps, support: { ok: false, reason: 'insecure-context' } };
    const c = new AudioController({ isViewer: () => false, onFrame: () => {}, deps, storage: null });
    expect(c.supported).toBe(false);
    expect(c.unsupportedReason).toBe('insecure-context');
    await c.start();
    expect(c.status).toBe('error');
    expect(c.error).toBe('unsupported');
    expect(f.tracks).toHaveLength(0);
  });
});
