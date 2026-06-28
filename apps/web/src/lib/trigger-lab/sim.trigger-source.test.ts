import { describe, expect, it } from 'vitest';
import { makeNode, normalizeTriggerValue, type GraphNode } from './sim';

/* The trigger-source value seam (U1 T1): one pure 0..1 normalizer every source feeds, so
   drum / MIDI / OSC route through the switch `value` mode identically. Not yet wired into
   eval — these lock the contract U2/U3 build on. */

describe('normalizeTriggerValue — one 0..1 seam for all three sources', () => {
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
    expect(normalizeTriggerValue({ kind: 'osc', arg: 1 })).toBe(1);
  });

  it('clamps every source to 0..1 for out-of-range inputs', () => {
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 1.5 })).toBe(1);
    expect(normalizeTriggerValue({ kind: 'drum', velocity: -0.2 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'midi', value: 200 })).toBe(1); // > 127
    expect(normalizeTriggerValue({ kind: 'midi', value: -5 })).toBe(0);
    expect(normalizeTriggerValue({ kind: 'osc', arg: 9 })).toBe(1);
    expect(normalizeTriggerValue({ kind: 'osc', arg: -3 })).toBe(0);
  });

  it('parity: a half-strength hit reads 0.5 whether it arrives as drum / MIDI / OSC', () => {
    expect(normalizeTriggerValue({ kind: 'drum', velocity: 0.5 })).toBe(0.5);
    expect(normalizeTriggerValue({ kind: 'midi', value: 63.5 })).toBeCloseTo(0.5); // 63.5/127
    expect(normalizeTriggerValue({ kind: 'osc', arg: 0.5 })).toBe(0.5);
  });
});

describe('TriggerSource on a trigger node', () => {
  it('a trigger node can carry each source variant', () => {
    const drum = makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'drum', drumId: 'kick', zone: '0' } });
    const note = makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'midi', note: 38 } });
    const cc = makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'midi', cc: 7 } });
    const osc = makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'osc', address: '/kick' } });
    expect(drum.source).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
    expect(note.source).toEqual({ kind: 'midi', note: 38 });
    expect(cc.source).toEqual({ kind: 'midi', cc: 7 });
    expect(osc.source).toEqual({ kind: 'osc', address: '/kick' });
  });

  it('source is additive — a node built without one has it undefined', () => {
    const n: GraphNode = makeNode('trigger', 'trigger');
    expect(n.source).toBeUndefined();
  });
});
