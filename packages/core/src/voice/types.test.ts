import { describe, expect, it } from 'vitest';
import { emptyShow, normalizeTriggerValue, type GraphNode, type Show, type SwitchOn, type TriggerGraph, type TriggerSource } from './types';

/* Core mirror of the trigger-source field (U1 T1). Core only carries the `source` shape
   so web graphs pass through `buildShow` structurally — resolution lives in a later slice.
   These guard the field's presence, optionality, and that it is plain serializable data. */

/** A fully-populated trigger node (every GraphNode field set) carrying an optional source. */
function triggerNode(source?: TriggerSource): GraphNode {
  return {
    id: 'trigger',
    kind: 'trigger',
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    source,
  };
}

describe('core voice TriggerSource mirror', () => {
  it('a trigger node carries each source variant', () => {
    expect(triggerNode({ kind: 'drum', drumId: 'kick', zone: '0' }).source).toEqual({ kind: 'drum', drumId: 'kick', zone: '0' });
    expect(triggerNode({ kind: 'midi', note: 38 }).source).toEqual({ kind: 'midi', note: 38 });
    expect(triggerNode({ kind: 'midi', cc: 7 }).source).toEqual({ kind: 'midi', cc: 7 });
    expect(triggerNode({ kind: 'osc', address: '/kick' }).source).toEqual({ kind: 'osc', address: '/kick' });
  });

  it('source is optional/additive — a node without one has it undefined', () => {
    expect(triggerNode().source).toBeUndefined();
  });

  it('a Show holds graphs whose trigger node carries a source (plain serializable data)', () => {
    const graph: TriggerGraph = { nodes: [triggerNode({ kind: 'osc', address: '/kick' })], edges: [] };
    const show: Show = { ...emptyShow(), graphs: { 'kick:0': graph } };
    // it survives a structural (JSON) round-trip — pure data, no behaviour attached
    const clone = JSON.parse(JSON.stringify(show)) as Show;
    expect(clone.graphs['kick:0']!.nodes[0]!.source).toEqual({ kind: 'osc', address: '/kick' });
  });
});

describe('normalizeTriggerValue — core mirror of the one 0..1 seam (U3)', () => {
  // Byte-identical to the web sim's seam: drum/key velocity passthrough · MIDI ÷127 ·
  // OSC arg as-is, all clamped. This is what `ctx.velocity` is fed from so all three
  // sources route through the switch `value` mode identically.
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

describe('SwitchOn — velocity folded into value', () => {
  it('no longer accepts velocity (type-level); the canonical modes remain', () => {
    // @ts-expect-error velocity was folded into `value` and removed from SwitchOn.
    const folded: SwitchOn = 'velocity';
    void folded;
    const ok: SwitchOn[] = ['section', 'beat', 'value'];
    expect(ok).toEqual(['section', 'beat', 'value']);
  });
});
