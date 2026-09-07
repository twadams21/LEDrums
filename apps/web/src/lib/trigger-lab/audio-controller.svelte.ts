/** Audio input controller (GH #214) — the lifecycle + settings state behind Settings › Input ›
    Audio input and the `audio` modulation source's meter. Owns ONE {@link AudioCaptureSession}
    (start / stop / device switch), the reactive status the panel renders, the latest meter frame,
    and the operator's local capture preferences (device, gain, noise floor, smoothing), persisted
    in localStorage — never in the show, which must not carry this machine's device ids.

    Reactivity lives here (Svelte 5 runes fields); the store delegates via getters/forwarders,
    exactly like {@link MidiController}. The store keeps the per-frame forwarding itself
    (`forwardAudio`: offline sim mirror + one WS event when connected) — injected as `onFrame`.

    Ownership: capture is an EDITOR/host affordance. A viewer cannot start it, and if this client
    drops to viewer while capturing, {@link enforceOwnership} stops it — a remote viewer must never
    become the authoritative audio stream. */

import { voice } from '@ledrums/core';
import {
  AudioCaptureSession,
  browserAudioCaptureDeps,
  type AudioCaptureDeps,
  type AudioCaptureErrorCode,
  type AudioCaptureStatus,
  type AudioInputInfo,
} from '../audio/capture';
import { DEFAULT_AUDIO_ANALYSIS_SETTINGS, sanitizeAudioAnalysisSettings, type AudioAnalysisSettings } from '../audio/analysis';

export const AUDIO_INPUT_STORAGE_KEY = 'ledrums.audio-input.v1';

export interface AudioControllerHost {
  /** Whether this client is a read-only viewer — start refuses, and a running capture stops. */
  isViewer(): boolean;
  /** Every analysed frame, including the explicit zero on stop/loss. */
  onFrame(frame: voice.AudioFeatureFrame): void;
  /** Injected browser surface (tests); defaults to the real feature-detected wiring. */
  deps?: AudioCaptureDeps;
  /** Where preferences persist (tests); defaults to `localStorage` when present. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

interface StoredPrefs {
  deviceId?: string | null;
  gain?: number;
  noiseFloorDb?: number;
  attackMs?: number;
  releaseMs?: number;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class AudioController {
  status = $state<AudioCaptureStatus>('idle');
  error = $state<AudioCaptureErrorCode | undefined>(undefined);
  message = $state<string | undefined>(undefined);
  /** The browser's own name for the live input once running. */
  trackLabel = $state<string | undefined>(undefined);
  sampleRate = $state<number | undefined>(undefined);
  /** Latest analysed frame — the settings meters read this. Zero when not running. */
  meter = $state<voice.AudioFeatureFrame>({ ...voice.ZERO_AUDIO_FRAME });
  /** Known audio inputs. Labels stay empty until the browser has granted permission once. */
  devices = $state<AudioInputInfo[]>([]);
  /** Selected input id, or null for the browser default. Local preference, not show data. */
  deviceId = $state<string | null>(null);
  settings = $state<AudioAnalysisSettings>({ ...DEFAULT_AUDIO_ANALYSIS_SETTINGS });

  readonly supported: boolean;
  readonly unsupportedReason: string | undefined;

  private readonly deps: AudioCaptureDeps;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly session: AudioCaptureSession;
  private unsubscribeDevices: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly host: AudioControllerHost) {
    this.deps = host.deps ?? browserAudioCaptureDeps();
    this.storage = host.storage === undefined ? defaultStorage() : host.storage;
    this.supported = this.deps.support.ok;
    this.unsupportedReason = this.deps.support.ok ? undefined : this.deps.support.reason;
    this.loadPrefs();
    this.session = new AudioCaptureSession(
      this.deps,
      {
        onFrame: (frame) => {
          this.meter = frame;
          this.host.onFrame(frame);
        },
        onStatus: (e) => {
          this.status = e.status;
          this.error = e.error;
          this.message = e.message;
          if (e.status === 'running') {
            this.trackLabel = e.trackLabel;
            this.sampleRate = e.sampleRate;
            // Permission has been granted now: device labels become readable.
            void this.refreshDevices();
          } else if (e.status !== 'suspended') {
            this.trackLabel = undefined;
            this.sampleRate = undefined;
          }
        },
      },
      () => this.settings,
    );
  }

  get running(): boolean {
    return this.session.isRunning;
  }

  /** Explicit user start (Enable). Refused for a viewer or after dispose. Never throws. */
  async start(): Promise<void> {
    if (this.disposed || this.host.isViewer()) return;
    await this.session.start(this.deviceId);
  }

  stop(): void {
    this.session.stop();
  }

  /** Pick an input. While running, restarts on the new device (the old session is released first). */
  setDevice(id: string | null): void {
    this.deviceId = id;
    this.savePrefs();
    if (this.running) void this.start();
  }

  setSettings(patch: Partial<AudioAnalysisSettings>): void {
    this.settings = sanitizeAudioAnalysisSettings({ ...this.settings, ...patch });
    this.savePrefs();
  }

  /** Enumerate inputs (never prompts). Subscribes to hot-plug on first call. */
  async refreshDevices(): Promise<void> {
    if (!this.supported || this.disposed) return;
    if (!this.unsubscribeDevices) this.unsubscribeDevices = this.deps.onDeviceChange(() => void this.refreshDevices());
    try {
      const list = await this.deps.enumerateInputs();
      if (!this.disposed) this.devices = list;
    } catch {
      /* enumeration is best-effort; the panel keeps its last list */
    }
  }

  /** Called by the store's loop: a client that is (or became) a viewer never captures. */
  enforceOwnership(isViewer: boolean): void {
    if (isViewer && (this.running || this.status === 'starting')) this.stop();
  }

  /** Store lifecycle stop / app dispose: release capture and hot-plug subscription. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.running || this.status === 'starting') this.stop();
    this.unsubscribeDevices?.();
    this.unsubscribeDevices = null;
  }

  /** DEV-only screenshot seam: stage a status + meter frame without any capture. Does not touch
      the session, so it can never leave a microphone open. */
  previewSynthetic(status: AudioCaptureStatus, meter: voice.AudioFeatureFrame, error?: AudioCaptureErrorCode): void {
    this.status = status;
    this.error = error;
    this.message = undefined;
    this.meter = voice.normalizeAudioFrame(meter);
    if (status === 'running') {
      this.trackLabel = 'Loopback (synthetic)';
      this.sampleRate = 48000;
    }
  }

  private loadPrefs(): void {
    try {
      const raw = this.storage?.getItem(AUDIO_INPUT_STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as StoredPrefs;
      this.deviceId = typeof p.deviceId === 'string' ? p.deviceId : null;
      this.settings = sanitizeAudioAnalysisSettings(p);
    } catch {
      /* corrupt or unavailable storage → defaults */
    }
  }

  private savePrefs(): void {
    try {
      const p: StoredPrefs = { deviceId: this.deviceId, ...this.settings };
      this.storage?.setItem(AUDIO_INPUT_STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* quota / private mode: preferences simply don't persist */
    }
  }
}
