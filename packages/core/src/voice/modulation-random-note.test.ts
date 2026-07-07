import { describe, expect, it } from 'vitest';
import { Prng } from './prng';
import {
  noteKey,
  quantizeSteppedRandom,
  sampleNote,
  sampleRandomDistribution,
  type NoteState,
} from './modulation';

describe('note modulation sampling', () => {
  it('samples gate, velocity, channel filters and release deterministically', () => {
    const table = new Map<string, NoteState>();
    table.set(noteKey(60, null), { gate: 1, velocity: 0.75, releasedAtMs: null });
    table.set(noteKey(60, 2), { gate: 1, velocity: 0.4, releasedAtMs: 100 });

    expect(sampleNote(table, 60, null, 'gate', 0, 50)).toBe(1);
    expect(sampleNote(table, 60, null, 'velocity', 0, 50)).toBe(0.75);
    expect(sampleNote(table, 60, 2, 'velocity', 200, 150)).toBeCloseTo(0.3, 10);
    expect(sampleNote(table, 60, 2, 'gate', 200, 150)).toBeCloseTo(0.75, 10);
    expect(sampleNote(table, 60, 3, 'gate', 200, 150)).toBe(0);
    expect(sampleNote(new Map([[noteKey(61, null), { gate: 0, velocity: 0, releasedAtMs: 100 }]]), 61, null, 'gate', 200, 150)).toBe(0);
  });
});

describe('random modulation distributions', () => {
  it('are deterministic for the same seeded stream', () => {
    const a = new Prng(123);
    const b = new Prng(123);
    const distributions = ['linear', 'gaussian', 'exponential', 'logarithmic', 'triangular', 'beta', 'stepped'] as const;
    for (const d of distributions) {
      expect(sampleRandomDistribution(d, a)).toBe(sampleRandomDistribution(d, b));
    }
  });

  it('quantizes stepped random to the requested step lattice', () => {
    expect(quantizeSteppedRandom(0, 5)).toBe(0);
    expect(quantizeSteppedRandom(0.24, 5)).toBe(0.25);
    expect(quantizeSteppedRandom(0.51, 5)).toBe(0.5);
    expect(quantizeSteppedRandom(1, 5)).toBe(1);
  });
});
