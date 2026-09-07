/**
 * Browser audio capture adapter (GH #214) — the lifecycle shell around `analysis.ts`: open the
 * selected input with `getUserMedia`, feed one `AnalyserNode` through one `AudioContext`, and
 * sample it on a managed timer at ≤ {@link AUDIO_FEATURE_HZ}. Every browser dependency is injected
 * through {@link AudioCaptureDeps} so the state machine is testable without Web Audio; the real
 * wiring is {@link browserAudioCaptureDeps}.
 *
 * Guarantees the rest of the app leans on:
 *  - Explicit start only. Nothing here touches the microphone until `start()` is called.
 *  - Nothing is recorded, streamed or played: the source connects ONLY to the analyser, never to
 *    `destination`, and the only thing that leaves is a four-number feature frame.
 *  - One context, one source, one analyser, two reused typed arrays per session.
 *  - Cancellation is exact: a `stop()` while the permission prompt is still open stops the tracks
 *    the moment they arrive; a restart tears the previous session down first.
 *  - Silence is explicit: a stop, a lost track, or a suspended/interrupted context emits one
 *    all-zero frame so a downstream mapping returns to rest instead of freezing.
 *
 * FFT size is {@link AUDIO_FFT_SIZE} (2048): at 48 kHz that is 23 Hz per bin, so the 20–250 Hz bass
 * band still spans ~10 bins, while the analyser's window (43 ms) keeps the reading responsive at
 * the 30 Hz feature rate. 4096 would halve the bin width but double the latency for no musical
 * gain at these band edges.
 */
import { voice } from '@ledrums/core';
import { analyzeFrame, type AudioAnalysisSettings } from './analysis';

export const AUDIO_FFT_SIZE = 2048;
/** Feature frames per second, and therefore the WS send rate while capturing. */
export const AUDIO_FEATURE_HZ = 30;
export const AUDIO_FEATURE_INTERVAL_MS = Math.ceil(1000 / AUDIO_FEATURE_HZ);

// ---- Injected browser surface -----------------------------------------------

/** An audio input the user can pick. `label` is empty until the browser has granted permission. */
export interface AudioInputInfo {
  id: string;
  label: string;
}

export interface AnalyserLike {
  fftSize: number;
  smoothingTimeConstant: number;
  getFloatTimeDomainData(target: Float32Array): void;
  getFloatFrequencyData(target: Float32Array): void;
  disconnect(): void;
}

export interface SourceNodeLike {
  connect(target: AnalyserLike): unknown;
  disconnect(): void;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  /** 'suspended' | 'running' | 'closed' | 'interrupted' (Safari). */
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: MediaStreamLike): SourceNodeLike;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

export interface TrackLike {
  readonly readyState: string;
  readonly label?: string;
  stop(): void;
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
}

export interface MediaStreamLike {
  getAudioTracks(): TrackLike[];
}

export type AudioUnsupportedReason = 'insecure-context' | 'no-media-devices' | 'no-audio-context';

export interface AudioCaptureDeps {
  /** Feature detection, decided once. */
  readonly support: { ok: true } | { ok: false; reason: AudioUnsupportedReason };
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  /** Audio INPUT devices only. */
  enumerateInputs(): Promise<AudioInputInfo[]>;
  createContext(): AudioContextLike;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Monotonic ms, for the smoothing `dt`. */
  now(): number;
  /** Subscribe to hot-plug; returns the unsubscribe. */
  onDeviceChange(listener: () => void): () => void;
}

/** The real browser wiring. Never throws: an unsupported environment (no secure context, no
    `mediaDevices`, no `AudioContext`, or a non-browser runtime) yields `support.ok === false`. */
export function browserAudioCaptureDeps(): AudioCaptureDeps {
  const g = globalThis as unknown as {
    isSecureContext?: boolean;
    navigator?: { mediaDevices?: MediaDevices };
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
    performance?: { now(): number };
  };
  const media = g.navigator?.mediaDevices;
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  const support: AudioCaptureDeps['support'] =
    g.isSecureContext === false ? { ok: false, reason: 'insecure-context' }
    : !media || typeof media.getUserMedia !== 'function' ? { ok: false, reason: 'no-media-devices' }
    : !Ctx ? { ok: false, reason: 'no-audio-context' }
    : { ok: true };
  return {
    support,
    getUserMedia: (constraints) => media!.getUserMedia(constraints) as Promise<MediaStreamLike>,
    enumerateInputs: async () => {
      if (!media || typeof media.enumerateDevices !== 'function') return [];
      const all = await media.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label ?? '' }));
    },
    createContext: () => new Ctx!() as unknown as AudioContextLike,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    now: () => (g.performance ? g.performance.now() : Date.now()),
    onDeviceChange: (listener) => {
      if (!media || typeof media.addEventListener !== 'function') return () => {};
      media.addEventListener('devicechange', listener);
      return () => media.removeEventListener('devicechange', listener);
    },
  };
}

// ---- Session state machine ------------------------------------------------

export type AudioCaptureStatus =
  | 'idle'
  | 'starting'
  | 'running'
  /** The context is suspended / interrupted (tab backgrounded, Safari interruption). */
  | 'suspended'
  /** The selected input went away mid-capture (unplugged, revoked). */
  | 'device-lost'
  | 'stopped'
  | 'error';

export type AudioCaptureErrorCode = 'unsupported' | 'permission-denied' | 'no-device' | 'failed';

export interface AudioCaptureStatusEvent {
  status: AudioCaptureStatus;
  error?: AudioCaptureErrorCode;
  /** Human detail for the error / the browser's own message. */
  message?: string;
  /** The live track label once running (the browser's device name). */
  trackLabel?: string;
  sampleRate?: number;
}

export interface AudioCaptureEvents {
  onFrame(frame: voice.AudioFeatureFrame): void;
  onStatus(event: AudioCaptureStatusEvent): void;
}

/** Map a `getUserMedia` rejection to the codes the UI has copy for. */
export function classifyCaptureError(err: unknown): { error: AudioCaptureErrorCode; message: string } {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return { error: 'permission-denied', message };
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return { error: 'no-device', message };
  return { error: 'failed', message };
}

/** Thrown inside `start()` to route a classified failure through the one cleanup path. */
class CaptureFailure extends Error {
  constructor(readonly detail: { error: AudioCaptureErrorCode; message: string }) {
    super(detail.message);
  }
}
/** Sentinel for a start abandoned by `stop()`/restart mid-flight — cleaned up, never reported. */
const CANCELLED = Symbol('audio-capture-cancelled');

interface LiveResources {
  context: AudioContextLike;
  source: SourceNodeLike;
  analyser: AnalyserLike;
  tracks: TrackLike[];
  timer: unknown;
  onStateChange: () => void;
  onEnded: () => void;
}

/**
 * One capture lifecycle. `start()` may be called again to switch device (the previous session is
 * torn down first); `stop()` is idempotent and safe at any point, including mid-permission-prompt.
 */
export class AudioCaptureSession {
  private live: LiveResources | null = null;
  private generation = 0;
  private status: AudioCaptureStatus = 'idle';
  private lastFrame: voice.AudioFeatureFrame = { ...voice.ZERO_AUDIO_FRAME };
  private lastNow = 0;
  private timeDomain = new Float32Array(AUDIO_FFT_SIZE);
  private spectrumDb = new Float32Array(AUDIO_FFT_SIZE / 2);

  constructor(
    private readonly deps: AudioCaptureDeps,
    private readonly events: AudioCaptureEvents,
    private readonly settings: () => AudioAnalysisSettings,
  ) {}

  get currentStatus(): AudioCaptureStatus {
    return this.status;
  }

  get isRunning(): boolean {
    return this.live !== null;
  }

  /**
   * Open `deviceId` (null = the browser's default input) and start emitting frames. Resolves once
   * running or once the failure has been reported through `onStatus`; never rejects.
   *
   * Order matters for activation: the `AudioContext` is created and its `resume()` issued
   * SYNCHRONOUSLY, before the first `await`, because `start()` is only ever called from the Enable
   * click and Safari/WKWebView can drop transient user activation across an awaited permission
   * prompt. The resume's outcome is only awaited after the stream is in hand.
   *
   * The whole startup is exception-safe: any throw or a `stop()`/restart during either await
   * releases every partially acquired resource (tracks, context) before returning.
   */
  async start(deviceId: string | null): Promise<void> {
    this.teardown(); // a restart never leaks the previous context/tracks/timer
    const gen = ++this.generation;
    if (!this.deps.support.ok) {
      this.report({ status: 'error', error: 'unsupported', message: this.deps.support.reason });
      return;
    }
    this.report({ status: 'starting' });

    let context: AudioContextLike | null = null;
    let tracks: TrackLike[] = [];
    const abandon = (): void => {
      for (const t of tracks) t.stop();
      tracks = [];
      if (context) void context.close().catch(() => undefined);
      context = null;
    };
    const stale = (): boolean => gen !== this.generation;

    try {
      // 1. Context + resume inside the gesture (synchronous — see the header).
      context = this.deps.createContext();
      const resuming: Promise<void> = context.state !== 'running' ? context.resume() : Promise.resolve();
      resuming.catch(() => undefined); // observed again below; this only prevents an unhandled rejection

      // 2. The input stream (the permission prompt lives here).
      let stream: MediaStreamLike;
      try {
        stream = await this.deps.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      } catch (err) {
        throw new CaptureFailure(classifyCaptureError(err));
      }
      tracks = stream.getAudioTracks();
      if (stale()) throw CANCELLED; // stop()/restart raced the prompt: the late tracks must not stay hot
      if (tracks.length === 0) throw new CaptureFailure({ error: 'no-device', message: 'The stream carried no audio track.' });

      // 3. The resume's outcome.
      try {
        await resuming;
      } catch (err) {
        throw new CaptureFailure({ error: 'failed', message: err instanceof Error ? err.message : String(err) });
      }
      if (stale()) throw CANCELLED;

      // 4. The analysis graph: source → analyser only, never `destination`.
      const analyser = context.createAnalyser();
      analyser.fftSize = AUDIO_FFT_SIZE;
      analyser.smoothingTimeConstant = 0; // our own attack/release does the smoothing, dt-aware
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const onStateChange = (): void => this.handleStateChange();
      const onEnded = (): void => this.handleEnded();
      context.addEventListener('statechange', onStateChange);
      for (const t of tracks) t.addEventListener('ended', onEnded);
      this.lastFrame = { ...voice.ZERO_AUDIO_FRAME };
      this.lastNow = this.deps.now();
      const timer = this.deps.setInterval(() => this.sample(), AUDIO_FEATURE_INTERVAL_MS);
      this.live = { context, source, analyser, tracks, timer, onStateChange, onEnded };
      this.report({
        status: context.state === 'running' ? 'running' : 'suspended',
        trackLabel: tracks[0]?.label,
        sampleRate: context.sampleRate,
      });
    } catch (err) {
      abandon();
      if (stale() || err === CANCELLED) return; // cancelled: the stop already reported
      const failure = err instanceof CaptureFailure ? err.detail : { error: 'failed' as const, message: err instanceof Error ? err.message : String(err) };
      this.report({ status: 'error', ...failure });
    }
  }

  /** Release everything and emit one zero frame. Safe to call repeatedly or while starting. */
  stop(): void {
    const wasLive = this.live !== null || this.status === 'starting';
    this.generation++;
    this.teardown();
    if (wasLive || this.status !== 'stopped') {
      this.emitZero();
      this.report({ status: 'stopped' });
    }
  }

  private sample(): void {
    const live = this.live;
    if (!live) return;
    const now = this.deps.now();
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    if (live.context.state !== 'running') {
      // Suspended / interrupted: no data is flowing, so do not hold the last reading.
      if (this.lastFrame.level > 0 || this.lastFrame.bass > 0 || this.lastFrame.mids > 0 || this.lastFrame.highs > 0) this.emitZero();
      return;
    }
    live.analyser.getFloatTimeDomainData(this.timeDomain);
    live.analyser.getFloatFrequencyData(this.spectrumDb);
    const frame = analyzeFrame(
      { timeDomain: this.timeDomain, spectrumDb: this.spectrumDb, sampleRate: live.context.sampleRate, fftSize: AUDIO_FFT_SIZE },
      this.settings(),
      this.lastFrame,
      dt,
    );
    this.lastFrame = frame;
    this.events.onFrame(frame);
  }

  private handleStateChange(): void {
    const live = this.live;
    if (!live) return;
    if (live.context.state === 'running') {
      this.report({ status: 'running', trackLabel: live.tracks[0]?.label, sampleRate: live.context.sampleRate });
    } else if (live.context.state === 'closed') {
      this.generation++;
      this.teardown();
      this.emitZero();
      this.report({ status: 'device-lost', message: 'The audio context was closed.' });
    } else {
      this.emitZero();
      this.report({ status: 'suspended' });
    }
  }

  private handleEnded(): void {
    if (!this.live) return;
    this.generation++;
    this.teardown();
    this.emitZero();
    this.report({ status: 'device-lost', message: 'The audio input ended.' });
  }

  private emitZero(): void {
    this.lastFrame = { ...voice.ZERO_AUDIO_FRAME };
    this.events.onFrame({ ...voice.ZERO_AUDIO_FRAME });
  }

  private report(event: AudioCaptureStatusEvent): void {
    this.status = event.status;
    this.events.onStatus(event);
  }

  private teardown(): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    this.deps.clearInterval(live.timer);
    live.context.removeEventListener('statechange', live.onStateChange);
    for (const t of live.tracks) {
      t.removeEventListener('ended', live.onEnded);
      t.stop();
    }
    try { live.source.disconnect(); } catch { /* already disconnected */ }
    try { live.analyser.disconnect(); } catch { /* already disconnected */ }
    void live.context.close().catch(() => undefined);
  }
}
