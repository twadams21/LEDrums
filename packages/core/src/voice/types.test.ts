import { describe, expect, it } from 'vitest';
import { normalizeTriggerValue } from './types';

describe('normalizeTriggerValue — core mirror of the one 0..1 seam (U3)', () => {
  // Drum/key velocity passthrough · MIDI ÷127 · OSC arg as-is, all clamped. This is the
  // velocity an Effect fires with, identical across all three sources.
  it('drum velocity passes through (already 0..1)', () => {
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 0 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 0.5 })).toBe(0.5);
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 1 })).toBe(1);
  });

  it('MIDI note-velocity / CC divides by 127', () => {
    expect(normalizeTriggerValue({ kind: 'midi', value: 0 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'midi', value: 127 })).toBe(1);
    expect(normalizeTriggerValue({ kind: 'midi', value: 64 })).toBeCloseTo(64 / 127);
  });

  it('OSC arg is taken as-is (0..1 float)', () => {
    expect(normalizeTriggerValue({ kind: 'osc', arg: 0 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'osc', arg: 0.42 })).toBe(0.42);
  });

  it('clamps every source to 0..1', () => {
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 1.5 })).toBe(1);
    expect(normalizeTriggerValue({ kind: 'midi', value: 200 })).toBe(1);
    expect(normalizeTriggerValue({ kind: 'midi', value: -5 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'osc', arg: -3 })).toBe(0);
  });

  it('parity: a half-strength hit reads 0.5 as drum / MIDI / OSC alike', () => {
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 0.5 })).toBe(0.5);
    expect(normalizeTriggerValue({ kind: 'midi', value: 63.5 })).toBeCloseTo(0.5);
    expect(normalizeTriggerValue({ kind: 'osc', arg: 0.5 })).toBe(0.5);
  });
});
