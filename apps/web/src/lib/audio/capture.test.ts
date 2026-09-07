import { describe, expect, it, vi } from 'vitest';
import { voice } from '@ledrums/core';
import {
  AUDIO_FEATURE_INTERVAL_MS,
  AUDIO_FFT_SIZE,
  AudioCaptureSession,
  browserAudioCaptureDeps,
  classifyCaptureError,
  type AudioCaptureDeps,
  type AudioCaptureStatusEvent,
  type AudioContextLike,
  type MediaStreamLike,
  type TrackLike,
} from './capture';
import { DEFAULT_AUDIO_ANALYSIS_SETTINGS } from './analysis';

/* The capture lifecycle against a fully fake browser: every dependency is injected, so each
   guarantee in capture.ts's header is asserted here without a microphone or Web Audio. */

class FakeTrack implements TrackLike {
  readyState = 'live';
  label = 'Loopback 1';
  stopped = 0;
  private listeners = new Set<() => void>();
  stop(): void { this.stopped++; this.readyState = 'ended'; }
  addEventListener(_t: 'ended', l: () => void): void { this.listeners.add(l); }
  removeEventListener(_t: 'ended', l: () => void): void { this.listeners.delete(l); }
  fireEnded(): void { for (const l of [...this.listeners]) l(); }
  get listenerCount(): number { return this.listeners.size; }
}

class FakeContext implements AudioContextLike {
  sampleRate = 48000;
  state = 'suspended';
  closed = 0;
  resumed = 0;
  analysers = 0;
  sources = 0;
  disconnected = 0;
  connectedTo: unknown = null;
  private listeners = new Set<() => void>();
  /** What the analyser will report: a full-scale 100 Hz sine or silence. */
  loud = false;
  /** Failure injection for the startup paths. */
  resumeMode: 'ok' | 'reject' | 'pending' = 'ok';
  failAnalyser = false;
  failSource = false;
  private pendingResume: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  resume(): Promise<void> {
    this.resumed++;
    if (this.resumeMode === 'reject') return Promise.reject(new Error('resume refused'));
    if (this.resumeMode === 'pending') return new Promise<void>((resolve, reject) => { this.pendingResume = { resolve: () => { this.state = 'running'; resolve(); }, reject }; });
    this.state = 'running';
    return Promise.resolve();
  }
  settleResume(): void { this.pendingResume?.resolve(); }
  async close(): Promise<void> { this.closed++; this.state = 'closed'; }
  createAnalyser(): ReturnType<AudioContextLike['createAnalyser']> {
    if (this.failAnalyser) throw new Error('analyser refused');
    this.analysers++;
    const ctx = this;
    return {
      fftSize: 0,
      smoothingTimeConstant: 0.8,
      getFloatTimeDomainData(a: Float32Array): void {
        for (let i = 0; i < a.length; i++) a[i] = ctx.loud ? Math.sin((2 * Math.PI * 100 * i) / ctx.sampleRate) : 0;
      },
      getFloatFrequencyData(a: Float32Array): void {
        a.fill(Number.NEGATIVE_INFINITY);
        if (ctx.loud) a[Math.round((100 * AUDIO_FFT_SIZE) / ctx.sampleRate)] = -10;
      },
      disconnect(): void { ctx.disconnected++; },
    };
  }
  createMediaStreamSource(): ReturnType<AudioContextLike['createMediaStreamSource']> {
    if (this.failSource) throw new Error('source refused');
    this.sources++;
    const ctx = this;
    return { connect(t): void { ctx.connectedTo = t; }, disconnect(): void { ctx.disconnected++; } };
  }
  addEventListener(_t: 'statechange', l: () => void): void { this.listeners.add(l); }
  removeEventListener(_t: 'statechange', l: () => void): void { this.listeners.delete(l); }
  setState(state: string): void { this.state = state; for (const l of [...this.listeners]) l(); }
  get listenerCount(): number { return this.listeners.size; }
}

interface Fake {
  deps: AudioCaptureDeps;
  tracks: FakeTrack[];
  contexts: FakeContext[];
  timers: Map<unknown, () => void>;
  resolveMedia: (() => void) | null;
  rejectMedia: ((err: unknown) => void) | null;
  constraints: MediaStreamConstraints[];
  clock: { now: number };
  tick(): void;
}

/** A fake browser. `pending` holds the permission prompt open until `resolveMedia()`. */
function fake(opts: { pending?: boolean; unsupported?: 'insecure-context' | 'no-media-devices' | 'no-audio-context'; context?: (c: FakeContext) => void } = {}): Fake {
  const state: Fake = {
    tracks: [], contexts: [], timers: new Map(), resolveMedia: null, rejectMedia: null, constraints: [], clock: { now: 1000 },
    deps: undefined as unknown as AudioCaptureDeps,
    tick(): void { state.clock.now += AUDIO_FEATURE_INTERVAL_MS; for (const fn of [...state.timers.values()]) fn(); },
  };
  let nextTimer = 1;
  state.deps = {
    support: opts.unsupported ? { ok: false, reason: opts.unsupported } : { ok: true },
    getUserMedia: (constraints) => {
      state.constraints.push(constraints);
      const track = new FakeTrack();
      state.tracks.push(track);
      const stream: MediaStreamLike = { getAudioTracks: () => [track] };
      if (!opts.pending) return Promise.resolve(stream);
      return new Promise<MediaStreamLike>((resolve, reject) => {
        state.resolveMedia = () => resolve(stream);
        state.rejectMedia = reject;
      });
    },
    enumerateInputs: async () => [{ id: 'dev-1', label: 'Loopback 1' }],
    createContext: () => { const c = new FakeContext(); opts.context?.(c); state.contexts.push(c); return c; },
    setInterval: (fn) => { const h = nextTimer++; state.timers.set(h, fn); return h; },
    clearInterval: (h) => { state.timers.delete(h); },
    now: () => state.clock.now,
    onDeviceChange: () => () => {},
  };
  return state;
}

function session(f: Fake): { s: AudioCaptureSession; frames: voice.AudioFeatureFrame[]; statuses: AudioCaptureStatusEvent[] } {
  const frames: voice.AudioFeatureFrame[] = [];
  const statuses: AudioCaptureStatusEvent[] = [];
  const s = new AudioCaptureSession(f.deps, { onFrame: (fr) => frames.push(fr), onStatus: (e) => statuses.push(e) }, () => DEFAULT_AUDIO_ANALYSIS_SETTINGS);
  return { s, frames, statuses };
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ZERO = voice.ZERO_AUDIO_FRAME;

describe('AudioCaptureSession — start', () => {
  it('opens the selected device with processing off, one context/source/analyser, and reports running', async () => {
    const f = fake();
    const { s, statuses } = session(f);
    await s.start('dev-1');
    expect(f.constraints[0]).toEqual({
      audio: { deviceId: { exact: 'dev-1' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const ctx = f.contexts[0]!;
    expect(f.contexts).toHaveLength(1);
    expect(ctx.resumed).toBe(1); // activation from the user gesture
    expect(ctx.analysers).toBe(1);
    expect(ctx.sources).toBe(1);
    expect(ctx.connectedTo).not.toBeNull(); // source → analyser only
    expect(statuses.map((e) => e.status)).toEqual(['starting', 'running']);
    expect(statuses[1]).toMatchObject({ trackLabel: 'Loopback 1', sampleRate: 48000 });
    expect(s.isRunning).toBe(true);
  });

  it('uses the default input when no device is selected', async () => {
    const f = fake();
    await session(f).s.start(null);
    expect(f.constraints[0]!.audio).not.toHaveProperty('deviceId');
  });

  it('emits analysed frames on the managed timer (≤30 Hz), reusing the session arrays', async () => {
    const f = fake();
    const { s, frames } = session(f);
    await s.start(null);
    f.contexts[0]!.loud = true;
    for (let i = 0; i < 20; i++) f.tick();
    expect(frames.length).toBe(20);
    const last = frames.at(-1)!;
    expect(last.level).toBeGreaterThan(0.9);
    expect(last.bass).toBeGreaterThan(0.9);
    expect(last.mids).toBe(0);
    expect(frames[0]!.bass).toBeLessThan(last.bass); // attack smoothing
    expect(AUDIO_FEATURE_INTERVAL_MS).toBeGreaterThanOrEqual(33);
  });

  it('reports unsupported without touching getUserMedia', async () => {
    const f = fake({ unsupported: 'insecure-context' });
    const { s, statuses } = session(f);
    await s.start(null);
    expect(statuses).toEqual([{ status: 'error', error: 'unsupported', message: 'insecure-context' }]);
    expect(f.constraints).toHaveLength(0);
  });

  it('maps getUserMedia failures to actionable codes', async () => {
    const f = fake({ pending: true });
    const { s, statuses } = session(f);
    const p = s.start(null);
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    f.rejectMedia!(denied);
    await p;
    expect(statuses.at(-1)).toMatchObject({ status: 'error', error: 'permission-denied' });
    expect(classifyCaptureError({ name: 'NotFoundError' }).error).toBe('no-device');
    expect(classifyCaptureError({ name: 'OverconstrainedError' }).error).toBe('no-device');
    expect(classifyCaptureError(new Error('boom')).error).toBe('failed');
    expect(s.isRunning).toBe(false);
  });
});

describe('AudioCaptureSession — stop and cancellation', () => {
  it('stop releases timer, listeners, tracks and context, and emits exactly one zero frame', async () => {
    const f = fake();
    const { s, frames, statuses } = session(f);
    await s.start(null);
    f.contexts[0]!.loud = true;
    f.tick();
    expect(frames.at(-1)!.level).toBeGreaterThan(0);
    s.stop();
    const ctx = f.contexts[0]!;
    const track = f.tracks[0]!;
    expect(f.timers.size).toBe(0);
    expect(track.stopped).toBe(1);
    expect(track.listenerCount).toBe(0);
    expect(ctx.listenerCount).toBe(0);
    expect(ctx.closed).toBe(1);
    expect(ctx.disconnected).toBe(2); // source + analyser
    expect(frames.at(-1)).toEqual(ZERO);
    expect(statuses.at(-1)!.status).toBe('stopped');
    const n = frames.length;
    s.stop(); // idempotent: no second zero frame, no second status
    f.tick(); // the cleared timer must not fire
    expect(frames.length).toBe(n);
    expect(statuses.filter((e) => e.status === 'stopped')).toHaveLength(1);
  });

  it('a stop during the permission prompt stops the late-returned tracks and opens no context', async () => {
    const f = fake({ pending: true });
    const { s, statuses } = session(f);
    const p = s.start(null);
    expect(statuses.at(-1)!.status).toBe('starting');
    s.stop();
    expect(statuses.at(-1)!.status).toBe('stopped');
    f.resolveMedia!();
    await p;
    await flush();
    expect(f.tracks[0]!.stopped).toBe(1);
    expect(f.contexts).toHaveLength(1); // opened in the gesture…
    expect(f.contexts[0]!.closed).toBe(1); // …and closed by the cancelled start
    expect(s.isRunning).toBe(false);
    expect(statuses.map((e) => e.status)).toEqual(['starting', 'stopped']); // the stale start reported nothing more
  });

  it('a restart during the prompt discards the first stream and keeps only the second', async () => {
    const f = fake({ pending: true });
    const { s } = session(f);
    const first = s.start('a');
    const firstResolve = f.resolveMedia!;
    const second = s.start('b');
    const secondResolve = f.resolveMedia!;
    firstResolve();
    secondResolve();
    await Promise.all([first, second]);
    await flush();
    expect(f.tracks[0]!.stopped).toBe(1); // stale stream released
    expect(f.tracks[1]!.stopped).toBe(0); // live
    expect(f.contexts).toHaveLength(2);
    expect(f.contexts[0]!.closed).toBe(1); // the first gesture's context is released
    expect(f.contexts[1]!.closed).toBe(0);
    expect(s.isRunning).toBe(true);
  });

  it('a restart while running tears the previous session down first (no leaked context/timer)', async () => {
    const f = fake();
    const { s } = session(f);
    await s.start('a');
    await s.start('b');
    expect(f.contexts[0]!.closed).toBe(1);
    expect(f.tracks[0]!.stopped).toBe(1);
    expect(f.contexts[1]!.closed).toBe(0);
    expect(f.timers.size).toBe(1);
  });
});

describe('AudioCaptureSession — loss and suspension', () => {
  it('a track ending zeros the features, releases resources and reports device-lost', async () => {
    const f = fake();
    const { s, frames, statuses } = session(f);
    await s.start(null);
    f.contexts[0]!.loud = true;
    f.tick();
    f.tracks[0]!.fireEnded();
    expect(frames.at(-1)).toEqual(ZERO);
    expect(statuses.at(-1)!.status).toBe('device-lost');
    expect(f.contexts[0]!.closed).toBe(1);
    expect(f.timers.size).toBe(0);
    expect(s.isRunning).toBe(false);
  });

  it('a suspended/interrupted context zeros the features and reports honestly, then resumes', async () => {
    const f = fake();
    const { s, frames, statuses } = session(f);
    await s.start(null);
    const ctx = f.contexts[0]!;
    ctx.loud = true;
    f.tick();
    expect(frames.at(-1)!.level).toBeGreaterThan(0);
    ctx.setState('interrupted');
    expect(frames.at(-1)).toEqual(ZERO);
    expect(statuses.at(-1)!.status).toBe('suspended');
    const n = frames.length;
    f.tick(); // no data flows while suspended: nothing new is emitted (no stale hold either)
    expect(frames.length).toBe(n);
    ctx.setState('running');
    expect(statuses.at(-1)!.status).toBe('running');
    f.tick();
    expect(frames.at(-1)!.level).toBeGreaterThan(0);
    expect(s.isRunning).toBe(true);
  });
});

describe('AudioCaptureSession — exception-safe startup', () => {
  it('creates and resumes the context synchronously in the gesture, before the permission prompt settles', async () => {
    const f = fake({ pending: true });
    const { s } = session(f);
    const p = s.start(null);
    expect(f.contexts).toHaveLength(1);
    expect(f.contexts[0]!.resumed).toBe(1);
    f.resolveMedia!();
    await p;
    expect(s.isRunning).toBe(true);
  });

  it('a rejected resume stops the tracks, closes the context and reports failed', async () => {
    const f = fake({ context: (c) => { c.resumeMode = 'reject'; } });
    const { s, statuses } = session(f);
    await s.start(null);
    expect(statuses.at(-1)).toMatchObject({ status: 'error', error: 'failed', message: 'resume refused' });
    expect(f.tracks[0]!.stopped).toBe(1);
    expect(f.contexts[0]!.closed).toBe(1);
    expect(f.timers.size).toBe(0);
    expect(s.isRunning).toBe(false);
  });

  it('a getUserMedia failure also closes the context that was opened for the gesture', async () => {
    const f = fake({ pending: true });
    const { s } = session(f);
    const p = s.start(null);
    f.rejectMedia!(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    await p;
    expect(f.contexts[0]!.closed).toBe(1);
  });

  it('an analyser or source setup throw releases tracks + context and reports failed', async () => {
    for (const inject of [(c: FakeContext) => { c.failAnalyser = true; }, (c: FakeContext) => { c.failSource = true; }]) {
      const f = fake({ context: inject });
      const { s, statuses } = session(f);
      await s.start(null);
      expect(statuses.at(-1)!.status).toBe('error');
      expect(statuses.at(-1)!.error).toBe('failed');
      expect(f.tracks[0]!.stopped).toBe(1);
      expect(f.contexts[0]!.closed).toBe(1);
      expect(f.contexts[0]!.listenerCount).toBe(0);
      expect(f.timers.size).toBe(0);
      expect(s.isRunning).toBe(false);
    }
  });

  it('a stop during the resume await closes the context and stops the already-acquired tracks', async () => {
    const f = fake({ context: (c) => { c.resumeMode = 'pending'; } });
    const { s, statuses } = session(f);
    const p = s.start(null);
    await flush(); // getUserMedia resolved; now parked on resume
    s.stop();
    f.contexts[0]!.settleResume();
    await p;
    await flush();
    expect(f.tracks[0]!.stopped).toBe(1);
    expect(f.contexts[0]!.closed).toBe(1);
    expect(s.isRunning).toBe(false);
    expect(statuses.map((e) => e.status)).toEqual(['starting', 'stopped']);
  });
});

describe('browserAudioCaptureDeps', () => {
  it('feature-detects instead of throwing in a runtime without media APIs', () => {
    const deps = browserAudioCaptureDeps();
    expect(deps.support.ok).toBe(false);
    if (!deps.support.ok) expect(['no-media-devices', 'no-audio-context', 'insecure-context']).toContain(deps.support.reason);
  });
});
