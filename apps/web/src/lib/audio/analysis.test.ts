import { describe, expect, it } from 'vitest';
import {
  AUDIO_BAND_HZ,
  BAND_CALIBRATION_DB,
  DEFAULT_AUDIO_ANALYSIS_SETTINGS,
  analyzeFrame,
  bandBins,
  bandPowerDb,
  dbToUnit,
  measureFrame,
  rmsDbfs,
  sanitizeAudioAnalysisSettings,
  smoothTowards,
  type AnalysisInput,
} from './analysis';

/* Synthetic-signal coverage for the pure feature reducer: silence, a full-scale sine, a tone in
   one band, sample-rate-aware band edges, the gain / floor / smoothing controls, and finiteness
   against the analyser's -Infinity silence bins. No Web Audio anywhere. */

const FFT = 2048;
const settings = { ...DEFAULT_AUDIO_ANALYSIS_SETTINGS };

function silence(sampleRate = 48000): AnalysisInput {
  return { timeDomain: new Float32Array(FFT), spectrumDb: new Float32Array(FFT / 2).fill(Number.NEGATIVE_INFINITY), sampleRate, fftSize: FFT };
}

/** A full-scale sine at `hz` in the time domain, plus a spectrum with ONLY that tone's bin at
    `binDb` (everything else the analyser's -Infinity) — what an ideal analyser would report. */
function tone(hz: number, sampleRate: number, binDb: number, amplitude = 1): AnalysisInput {
  const timeDomain = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) timeDomain[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  const spectrumDb = new Float32Array(FFT / 2).fill(Number.NEGATIVE_INFINITY);
  spectrumDb[Math.round((hz * FFT) / sampleRate)] = binDb;
  return { timeDomain, spectrumDb, sampleRate, fftSize: FFT };
}

const ZERO = { level: 0, bass: 0, mids: 0, highs: 0 };
const isUnit = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1;

describe('rmsDbfs', () => {
  it('reads 0 dBFS for a full-scale sine and -Infinity for silence', () => {
    expect(rmsDbfs(tone(440, 48000, 0).timeDomain)).toBeCloseTo(0, 1);
    expect(rmsDbfs(new Float32Array(FFT))).toBe(Number.NEGATIVE_INFINITY);
    expect(rmsDbfs(new Float32Array(0))).toBe(Number.NEGATIVE_INFINITY);
  });
  it('drops 6 dB when amplitude halves, and ignores NaN samples', () => {
    expect(rmsDbfs(tone(440, 48000, 0, 0.5).timeDomain)).toBeCloseTo(-6.02, 1);
    const t = tone(440, 48000, 0).timeDomain;
    t[3] = Number.NaN;
    expect(Number.isFinite(rmsDbfs(t))).toBe(true);
  });
});

describe('bandBins — sample-rate-aware edges', () => {
  it('maps Hz to bin ranges at 48k and 44.1k and never includes DC', () => {
    expect(bandBins(20, 250, 48000, FFT)).toEqual([1, 11]); // 23.4 Hz/bin: bins 1..10
    expect(bandBins(20, 250, 44100, FFT)).toEqual([1, 12]); // 21.5 Hz/bin: bins 1..11
    const [s, e] = bandBins(2000, 12000, 48000, FFT);
    expect(s).toBe(Math.ceil(2000 / (48000 / FFT)));
    expect(e).toBe(Math.floor(12000 / (48000 / FFT)) + 1);
  });
  it('clips the top band at Nyquist for a low sample rate, and empties a band entirely above it', () => {
    const [s, e] = bandBins(2000, 12000, 16000, FFT); // Nyquist 8k
    expect(e).toBeLessThanOrEqual(FFT / 2);
    expect(e * (16000 / FFT)).toBeLessThanOrEqual(8000 + 16000 / FFT);
    expect(s).toBeGreaterThan(0);
    expect(bandBins(2000, 12000, 3000, FFT)).toEqual([0, 0]); // Nyquist 1.5k < 2k
    expect(bandBins(20, 250, 0, FFT)).toEqual([0, 0]);
  });
});

describe('bandPowerDb — power-aware, not dB-averaged', () => {
  it('sums linear power: two equal bins read +3 dB over one, and -Infinity bins contribute nothing', () => {
    const one = new Float32Array(FFT / 2).fill(Number.NEGATIVE_INFINITY);
    one[5] = -20;
    const two = Float32Array.from(one);
    two[6] = -20;
    expect(bandPowerDb(one, 48000, FFT, 20, 250)).toBeCloseTo(-20, 6);
    expect(bandPowerDb(two, 48000, FFT, 20, 250)).toBeCloseTo(-20 + 10 * Math.log10(2), 6);
    expect(bandPowerDb(one, 48000, FFT, 2000, 12000)).toBe(Number.NEGATIVE_INFINITY); // no energy there
  });
  it('is dominated by the loud bin (a dB average would not be)', () => {
    const s = new Float32Array(FFT / 2).fill(Number.NEGATIVE_INFINITY);
    s[5] = 0;
    for (let k = 6; k < 11; k++) s[k] = -60;
    expect(bandPowerDb(s, 48000, FFT, 20, 250)).toBeCloseTo(0, 2);
  });
});

describe('dbToUnit — gain, floor, clamp', () => {
  it('maps the floor to 0 and 0 dBFS to 1, linearly between', () => {
    expect(dbToUnit(-60, 1, -60)).toBe(0);
    expect(dbToUnit(0, 1, -60)).toBe(1);
    expect(dbToUnit(-30, 1, -60)).toBeCloseTo(0.5, 10);
  });
  it('gain lifts the reading in dB (x2 ≈ +6 dB); gain 0 and -Infinity read 0; never exceeds 1', () => {
    expect(dbToUnit(-36, 2, -60)).toBeCloseTo(dbToUnit(-36 + 6.02, 1, -60), 2);
    expect(dbToUnit(-6, 0, -60)).toBe(0);
    expect(dbToUnit(Number.NEGATIVE_INFINITY, 4, -60)).toBe(0);
    expect(dbToUnit(20, 4, -60)).toBe(1);
  });
  it('a higher noise floor silences quiet readings instead of pumping them up', () => {
    expect(dbToUnit(-50, 1, -60)).toBeGreaterThan(0);
    expect(dbToUnit(-50, 1, -40)).toBe(0);
  });
});

describe('smoothTowards — dt-derived attack/release', () => {
  it('rises on the attack constant and falls on the release constant', () => {
    const up = smoothTowards(0, 1, 15, 15, 180); // one attack tau → 63%
    expect(up).toBeCloseTo(1 - Math.exp(-1), 6);
    const down = smoothTowards(1, 0, 180, 15, 180); // one release tau
    expect(down).toBeCloseTo(Math.exp(-1), 6);
  });
  it('is rate-independent: two 16ms steps ≈ one 32ms step', () => {
    const two = smoothTowards(smoothTowards(0, 1, 16, 50, 50), 1, 16, 50, 50);
    expect(two).toBeCloseTo(smoothTowards(0, 1, 32, 50, 50), 10);
  });
  it('snaps with a zero time constant or zero dt', () => {
    expect(smoothTowards(0, 1, 16, 0, 0)).toBe(1);
    expect(smoothTowards(0, 1, 0, 50, 50)).toBe(1);
  });
});

describe('measureFrame / analyzeFrame — synthetic signals', () => {
  it('silence reads all zeros, and stays zero through smoothing', () => {
    expect(measureFrame(silence(), settings)).toEqual(ZERO);
    expect(analyzeFrame(silence(), settings, ZERO, 33)).toEqual(ZERO);
    expect(analyzeFrame(silence(), { ...settings, gain: 4 }, ZERO, 33)).toEqual(ZERO); // gain does not pump silence
  });

  it('a full-scale bass tone reads level ≈ 1, bass ≈ 1 and (near) zero in mids/highs', () => {
    const f = measureFrame(tone(100, 48000, -BAND_CALIBRATION_DB), settings);
    expect(f.level).toBeGreaterThan(0.95);
    expect(f.bass).toBeGreaterThan(0.95);
    expect(f.mids).toBe(0);
    expect(f.highs).toBe(0);
  });

  it('a tone in each band lights only that band', () => {
    const at = (hz: number): ReturnType<typeof measureFrame> => measureFrame(tone(hz, 48000, -BAND_CALIBRATION_DB), settings);
    expect(at(1000)).toMatchObject({ bass: 0, highs: 0 });
    expect(at(1000).mids).toBeGreaterThan(0.9);
    expect(at(5000)).toMatchObject({ bass: 0, mids: 0 });
    expect(at(5000).highs).toBeGreaterThan(0.9);
  });

  it('band edges follow the sample rate: the same bin index means different bands at 48k vs 16k', () => {
    // Bin 100 is 2344 Hz at 48k (highs) but 781 Hz at 16k (mids).
    const spec = new Float32Array(FFT / 2).fill(Number.NEGATIVE_INFINITY);
    spec[100] = 0;
    const input = (sampleRate: number): AnalysisInput => ({ timeDomain: new Float32Array(FFT), spectrumDb: spec, sampleRate, fftSize: FFT });
    expect(measureFrame(input(48000), settings).highs).toBeGreaterThan(0.9);
    expect(measureFrame(input(48000), settings).mids).toBe(0);
    expect(measureFrame(input(16000), settings).mids).toBeGreaterThan(0.9);
    expect(measureFrame(input(16000), settings).highs).toBe(0);
  });

  it('gain and floor act as documented on a quiet tone', () => {
    const quiet = tone(100, 48000, -50 - BAND_CALIBRATION_DB, 0.003); // ≈ -50 dBFS
    const base = measureFrame(quiet, settings).bass;
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThan(0.25);
    expect(measureFrame(quiet, { ...settings, gain: 4 }).bass).toBeGreaterThan(base);
    expect(measureFrame(quiet, { ...settings, noiseFloorDb: -40 }).bass).toBe(0);
  });

  it('smooths towards a new frame and keeps every output finite in 0..1 whatever the input', () => {
    const loud = tone(100, 48000, -BAND_CALIBRATION_DB);
    const partial = analyzeFrame(loud, settings, ZERO, 15);
    expect(partial.bass).toBeGreaterThan(0.5);
    expect(partial.bass).toBeLessThan(0.75);
    const junk: AnalysisInput = {
      timeDomain: Float32Array.from({ length: FFT }, (_, i) => (i % 2 ? Number.NaN : 5)),
      spectrumDb: Float32Array.from({ length: FFT / 2 }, (_, i) => (i % 3 === 0 ? Number.NaN : i % 3 === 1 ? Number.POSITIVE_INFINITY : 40)),
      sampleRate: 48000,
      fftSize: FFT,
    };
    const f = analyzeFrame(junk, settings, { level: Number.NaN, bass: 2, mids: -1, highs: 0.5 }, 33);
    for (const v of Object.values(f)) expect(isUnit(v)).toBe(true);
  });

  it('band edges are the documented fixed ranges', () => {
    expect(AUDIO_BAND_HZ).toEqual({ bass: [20, 250], mids: [250, 2000], highs: [2000, 12000] });
  });
});

describe('sanitizeAudioAnalysisSettings', () => {
  it('fills defaults, clamps into range and rejects non-finite values', () => {
    expect(sanitizeAudioAnalysisSettings(undefined)).toEqual(DEFAULT_AUDIO_ANALYSIS_SETTINGS);
    expect(sanitizeAudioAnalysisSettings({ gain: 9, noiseFloorDb: -200, attackMs: Number.NaN, releaseMs: -5 })).toEqual({
      gain: 4,
      noiseFloorDb: -90,
      attackMs: DEFAULT_AUDIO_ANALYSIS_SETTINGS.attackMs,
      releaseMs: 0,
    });
  });
});
