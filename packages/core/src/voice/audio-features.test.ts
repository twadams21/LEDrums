import { describe, expect, it } from 'vitest';
import {
  AUDIO_BANDS,
  AUDIO_STALE_MS,
  audioFeatureFrameSchema,
  audioValue01,
  isAudioBand,
  normalizeAudioFrame,
  sampleAudio,
  type AudioTable,
} from './audio-features';

describe('audio feature frame contract', () => {
  it('names exactly four bands in display order', () => {
    expect(AUDIO_BANDS).toEqual(['level', 'bass', 'mids', 'highs']);
    expect(isAudioBand('mids')).toBe(true);
    expect(isAudioBand('treble')).toBe(false);
    expect(isAudioBand(3)).toBe(false);
  });

  it('accepts finite 0..1 frames and rejects out-of-range, non-finite, missing and extra keys', () => {
    expect(audioFeatureFrameSchema.safeParse({ level: 0, bass: 0.5, mids: 1, highs: 0.25 }).success).toBe(true);
    expect(audioFeatureFrameSchema.safeParse({ level: -0.01, bass: 0, mids: 0, highs: 0 }).success).toBe(false);
    expect(audioFeatureFrameSchema.safeParse({ level: 1.01, bass: 0, mids: 0, highs: 0 }).success).toBe(false);
    expect(audioFeatureFrameSchema.safeParse({ level: Number.NaN, bass: 0, mids: 0, highs: 0 }).success).toBe(false);
    expect(audioFeatureFrameSchema.safeParse({ level: Number.POSITIVE_INFINITY, bass: 0, mids: 0, highs: 0 }).success).toBe(false);
    expect(audioFeatureFrameSchema.safeParse({ level: 0, bass: 0, mids: 0 }).success).toBe(false);
    expect(audioFeatureFrameSchema.safeParse({ level: 0, bass: 0, mids: 0, highs: 0, sub: 0 }).success).toBe(false);
  });

  it('normalises defensively: non-finite → 0, clamped to 0..1, missing bands → 0', () => {
    expect(audioValue01(Number.NaN)).toBe(0);
    expect(audioValue01(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(audioValue01(-2)).toBe(0);
    expect(audioValue01(7)).toBe(1);
    expect(audioValue01(0.3)).toBeCloseTo(0.3, 10);
    expect(normalizeAudioFrame({ level: 2, bass: Number.NaN })).toEqual({ level: 1, bass: 0, mids: 0, highs: 0 });
    expect(normalizeAudioFrame(undefined)).toEqual({ level: 0, bass: 0, mids: 0, highs: 0 });
  });
});

describe('sampleAudio — one freshness rule for every sampling path', () => {
  const table: AudioTable = { frame: { level: 0.9, bass: 0.6, mids: 0.3, highs: 0.1 }, atMs: 1000 };

  it('reads the requested band while the frame is fresh', () => {
    expect(sampleAudio(table, 'level', 1000)).toBeCloseTo(0.9, 10);
    expect(sampleAudio(table, 'bass', 1200)).toBeCloseTo(0.6, 10);
    expect(sampleAudio(table, 'mids', 1000 + AUDIO_STALE_MS)).toBeCloseTo(0.3, 10); // boundary is inclusive
  });

  it('reads 0 once the frame is older than AUDIO_STALE_MS — without any new event', () => {
    expect(sampleAudio(table, 'level', 1000 + AUDIO_STALE_MS + 1)).toBe(0);
    expect(sampleAudio(table, 'highs', 5000)).toBe(0);
  });

  it('reads 0 for an absent table (never heard) and for a non-finite clock', () => {
    expect(sampleAudio(undefined, 'level', 0)).toBe(0);
    expect(sampleAudio(null, 'bass', 0)).toBe(0);
    expect(sampleAudio(table, 'level', Number.NaN)).toBe(0);
  });
});
