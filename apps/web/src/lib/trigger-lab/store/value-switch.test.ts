import { describe, expect, it } from 'vitest';
import {
  addBand,
  canRemoveBand,
  clamp01,
  remapBandPorts,
  removeBandAt,
  setBandCutoff,
  stripBandPorts,
  valueDefaults,
} from './value-switch';
import { makeNode, type GraphEdge } from '../sim';

/* Pure value-switch math (the cutoff bookkeeping the store applies onto live nodes/edges).
   The store-level wiring is covered in store.value-switch.test.ts; this locks the maths in
   isolation, free of runes. */

describe('clamp01', () => {
  it('clamps into [0,1]', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe('valueDefaults', () => {
  it('backfills gate/0.5/false/[0.5] when fields are absent', () => {
    const node = makeNode('switch', 'sw', 0, 0);
    delete (node as { valueMode?: unknown }).valueMode;
    delete (node as { bands?: unknown }).bands;
    expect(valueDefaults(node)).toEqual({ valueMode: 'gate', threshold: 0.5, invert: false, bands: [0.5] });
  });

  it('keeps present values', () => {
    const node = makeNode('switch', 'sw', 0, 0, { valueMode: 'bands', threshold: 0.2, invert: true, bands: [0.3, 0.7] });
    expect(valueDefaults(node)).toEqual({ valueMode: 'bands', threshold: 0.2, invert: true, bands: [0.3, 0.7] });
  });
});

describe('addBand', () => {
  it('splits the final band (a new cutoff between the last and 1)', () => {
    expect(addBand([0.5])).toEqual([0.5, 0.75]);
    expect(addBand([0.2, 0.6])).toEqual([0.2, 0.6, 0.8]); // appends a cutoff between 0.6 and 1
  });
  it('treats empty/undefined as [0.5]', () => {
    expect(addBand(undefined)).toEqual([0.5, 0.75]);
    expect(addBand([])).toEqual([0.5, 0.75]);
  });
});

describe('canRemoveBand / removeBandAt', () => {
  it('refuses the last cutoff and out-of-range indices', () => {
    expect(canRemoveBand([0.5], 0)).toBe(false); // would leave zero cutoffs
    expect(canRemoveBand([0.3, 0.6], -1)).toBe(false);
    expect(canRemoveBand([0.3, 0.6], 2)).toBe(false);
    expect(canRemoveBand([0.3, 0.6], 1)).toBe(true);
  });
  it('drops the chosen cutoff', () => {
    expect(removeBandAt([0.3, 0.6, 0.8], 1)).toEqual([0.3, 0.8]);
  });
});

describe('setBandCutoff', () => {
  it('clamps within neighbours (never reorders)', () => {
    expect(setBandCutoff([0.2, 0.6], 0, 0.9)[0]).toBeCloseTo(0.6); // ≤ upper neighbour
    expect(setBandCutoff([0.2, 0.6], 1, 0.0)[1]).toBeCloseTo(0.2); // ≥ lower neighbour
    expect(setBandCutoff([0.2, 0.6], 0, 0.4)[0]).toBeCloseTo(0.4);
  });
  it('returns the contents unchanged for an out-of-range index', () => {
    expect(setBandCutoff([0.5], 5, 0.9)).toEqual([0.5]);
  });
});

describe('stripBandPorts', () => {
  it('collapses a node\'s outgoing band ports to the default output', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', from: 'sw', to: 'a', fromPort: 'band-0' },
      { id: 'e2', from: 'sw', to: 'b' },
      { id: 'e3', from: 'other', to: 'c', fromPort: 'band-1' }, // a different node — untouched
    ];
    const out = stripBandPorts(edges, 'sw');
    expect(out.filter((e) => e.from === 'sw').map((e) => e.fromPort)).toEqual([undefined, undefined]);
    expect(out.find((e) => e.id === 'e3')!.fromPort).toBe('band-1');
  });
});

describe('remapBandPorts', () => {
  it('shifts higher bands down after a merge and dedups collisions', () => {
    const edges: GraphEdge[] = [
      { id: 'e0', from: 'sw', to: 'a', fromPort: 'band-0' },
      { id: 'e1', from: 'sw', to: 'b', fromPort: 'band-1' },
      { id: 'e2', from: 'sw', to: 'c', fromPort: 'band-2' }, // shifts down into band-1
    ];
    const out = remapBandPorts(edges, 'sw', 1);
    const byTarget = new Map(out.map((e) => [e.to, e.fromPort]));
    expect(byTarget.get('a')).toBe('band-0');
    expect(byTarget.get('b')).toBe('band-1');
    expect(byTarget.get('c')).toBe('band-1');
  });

  it('drops a wire that collides onto the same (band, target) after the shift', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', from: 'sw', to: 'a', fromPort: 'band-1' },
      { id: 'e2', from: 'sw', to: 'a', fromPort: 'band-2' }, // → band-1, collides with e1 → drop
    ];
    const out = remapBandPorts(edges, 'sw', 1).filter((e) => e.to === 'a');
    expect(out).toHaveLength(1);
    expect(out[0]!.fromPort).toBe('band-1');
  });
});
