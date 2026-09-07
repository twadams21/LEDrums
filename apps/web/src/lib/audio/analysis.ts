/**
 * Pure audio feature analysis (GH #214) — turns one analyser snapshot (a time-domain block and a
 * dB power spectrum) into an {@link AudioFeatureFrame}. No Web Audio, no DOM, no clock: every input
 * is a plain typed array plus numbers, so the maths is testable with synthetic signals and the
 * capture adapter (`capture.ts`) stays a thin lifecycle shell around it.
 *
 * Reference scale (dBFS, 0 = full scale):
 *  - `level` is the block RMS expressed so a full-scale sine reads 0 dBFS
 *    (`20·log10(rms·√2)`), the conventional RMS meter convention.
 *  - `bass` / `mids` / `highs` sum the LINEAR power of the FFT bins inside each band (never an
 *    average of dB values, which would under-weight loud bins), convert back to dB, and add
 *    {@link BAND_CALIBRATION_DB} so a full-scale sine lands near 0 dBFS in its band after the
 *    analyser's Blackman window loss and main-lobe spread. Summing (not averaging) keeps a tone's
 *    reading independent of the band's width; pink-weighted music then reads roughly balanced
 *    across the three bands because they span similar octave counts.
 *  - Each dB reading is offset by the Gain (linear 0..4 → `20·log10(gain)`), then mapped from
 *    `[noiseFloorDb, 0]` onto `[0, 1]` and clamped. Nothing below the floor reads: silence is 0.
 *    There is NO automatic gain / loudness normalisation — quiet passages stay quiet instead of
 *    the meter pumping up on noise.
 *  - Attack/release smoothing is a first-order lag whose coefficient is derived from the real
 *    `dt`, so the response is the same at 30 Hz sampling as at any other rate.
 *
 * Every output is finite 0..1 by construction: `-Infinity` bins (the analyser's silence value),
 * NaN blocks and gain 0 all collapse to 0.
 */
import { voice } from '@ledrums/core';

type AudioBand = voice.AudioBand;
type AudioFeatureFrame = voice.AudioFeatureFrame;

/** Fixed band edges in Hz. `highs` is clipped at Nyquist for low sample rates. */
export const AUDIO_BAND_HZ: Readonly<Record<Exclude<AudioBand, 'level'>, readonly [number, number]>> = {
  bass: [20, 250],
  mids: [250, 2000],
  highs: [2000, 12000],
};

/** See the header: brings a full-scale sine's summed band power near 0 dBFS. Approximate — the
    exact figure depends on the analyser window and where the tone falls between bins. */
export const BAND_CALIBRATION_DB = 10;

export interface AudioAnalysisSettings {
  /** Linear input gain 0..4 (1 = unity, 4 ≈ +12 dB). */
  gain: number;
  /** dBFS below which everything reads 0. Typical -60; raise it in a noisy room. */
  noiseFloorDb: number;
  /** Rise time constant, ms. */
  attackMs: number;
  /** Fall time constant, ms. */
  releaseMs: number;
}

export const DEFAULT_AUDIO_ANALYSIS_SETTINGS: Readonly<AudioAnalysisSettings> = Object.freeze({
  gain: 1,
  noiseFloorDb: -60,
  attackMs: 15,
  releaseMs: 180,
});

export const AUDIO_GAIN_RANGE: readonly [number, number] = [0, 4];
export const AUDIO_NOISE_FLOOR_RANGE: readonly [number, number] = [-90, -20];
export const AUDIO_SMOOTHING_RANGE: readonly [number, number] = [0, 1000];

/** Clamp a settings object into its documented ranges (a persisted/typed value may be off). */
export function sanitizeAudioAnalysisSettings(input: Partial<AudioAnalysisSettings> | undefined): AudioAnalysisSettings {
  const d = DEFAULT_AUDIO_ANALYSIS_SETTINGS;
  const num = (v: unknown, fallback: number, [lo, hi]: readonly [number, number]): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return v < lo ? lo : v > hi ? hi : v;
  };
  return {
    gain: num(input?.gain, d.gain, AUDIO_GAIN_RANGE),
    noiseFloorDb: num(input?.noiseFloorDb, d.noiseFloorDb, AUDIO_NOISE_FLOOR_RANGE),
    attackMs: num(input?.attackMs, d.attackMs, AUDIO_SMOOTHING_RANGE),
    releaseMs: num(input?.releaseMs, d.releaseMs, AUDIO_SMOOTHING_RANGE),
  };
}

/** One analyser snapshot. `spectrumDb` holds `fftSize / 2` bins in dB (as `getFloatFrequencyData`
    fills it: `-Infinity` for silence). */
export interface AnalysisInput {
  timeDomain: Float32Array;
  spectrumDb: Float32Array;
  sampleRate: number;
  fftSize: number;
}

/** Block RMS as dBFS where a full-scale sine reads 0. Silence → `-Infinity`; NaN samples count as 0. */
export function rmsDbfs(timeDomain: Float32Array): number {
  const n = timeDomain.length;
  if (n === 0) return Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = timeDomain[i]!;
    if (Number.isFinite(x)) sum += x * x;
  }
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms * Math.SQRT2) : Number.NEGATIVE_INFINITY;
}

/**
 * The half-open FFT bin range `[start, end)` covering `lowHz..highHz` at this sample rate, clipped
 * to Nyquist and to the bin count. Empty (`start === end`) when the band lies entirely above
 * Nyquist. Bin `k` is centred on `k · sampleRate / fftSize`.
 */
export function bandBins(lowHz: number, highHz: number, sampleRate: number, fftSize: number): [number, number] {
  const binCount = Math.floor(fftSize / 2);
  if (!(sampleRate > 0) || binCount <= 0) return [0, 0];
  const hzPerBin = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const hi = Math.min(highHz, nyquist);
  if (!(hi > lowHz)) return [0, 0];
  const start = Math.max(1, Math.ceil(lowHz / hzPerBin)); // skip DC
  const end = Math.min(binCount, Math.floor(hi / hzPerBin) + 1);
  return start < end ? [start, end] : [0, 0];
}

/** Summed linear power of the bins in a band, back in dB (uncalibrated). Empty band / all-silent
    bins → `-Infinity`. Non-finite bins other than `-Infinity` are ignored. */
export function bandPowerDb(spectrumDb: Float32Array, sampleRate: number, fftSize: number, lowHz: number, highHz: number): number {
  const [start, end] = bandBins(lowHz, highHz, sampleRate, fftSize);
  let power = 0;
  for (let k = start; k < end && k < spectrumDb.length; k++) {
    const db = spectrumDb[k]!;
    if (db === Number.NEGATIVE_INFINITY || !Number.isFinite(db)) continue;
    power += Math.pow(10, db / 10);
  }
  return power > 0 ? 10 * Math.log10(power) : Number.NEGATIVE_INFINITY;
}

/** Map a dBFS reading through the gain and onto `[floorDb, 0] → [0, 1]`, clamped and finite. */
export function dbToUnit(db: number, gain: number, floorDb: number): number {
  if (!Number.isFinite(db) || !(gain > 0) || !(floorDb < 0)) return 0;
  const gained = db + 20 * Math.log10(gain);
  const unit = (gained - floorDb) / (0 - floorDb);
  return unit < 0 ? 0 : unit > 1 ? 1 : unit;
}

/** First-order lag towards `next` over `dtMs`: `attackMs` when rising, `releaseMs` when falling.
    A zero time constant snaps. */
export function smoothTowards(prev: number, next: number, dtMs: number, attackMs: number, releaseMs: number): number {
  const tau = next > prev ? attackMs : releaseMs;
  if (!(tau > 0) || !(dtMs > 0)) return next;
  const alpha = 1 - Math.exp(-dtMs / tau);
  return prev + (next - prev) * alpha;
}

/** The raw (unsmoothed) frame for one snapshot. */
export function measureFrame(input: AnalysisInput, settings: AudioAnalysisSettings): AudioFeatureFrame {
  const band = (key: Exclude<AudioBand, 'level'>): number => {
    const [lo, hi] = AUDIO_BAND_HZ[key];
    const db = bandPowerDb(input.spectrumDb, input.sampleRate, input.fftSize, lo, hi);
    return dbToUnit(db + BAND_CALIBRATION_DB, settings.gain, settings.noiseFloorDb);
  };
  return {
    level: dbToUnit(rmsDbfs(input.timeDomain), settings.gain, settings.noiseFloorDb),
    bass: band('bass'),
    mids: band('mids'),
    highs: band('highs'),
  };
}

/** Measure one snapshot and smooth it from `prev` over `dtMs`. Always returns a finite 0..1 frame. */
export function analyzeFrame(
  input: AnalysisInput,
  settings: AudioAnalysisSettings,
  prev: AudioFeatureFrame,
  dtMs: number,
): AudioFeatureFrame {
  const raw = measureFrame(input, settings);
  const s = (key: AudioBand): number => voice.audioValue01(smoothTowards(prev[key], raw[key], dtMs, settings.attackMs, settings.releaseMs));
  return { level: s('level'), bass: s('bass'), mids: s('mids'), highs: s('highs') };
}
