import { describe, expect, it } from 'vitest';
import {
  GEO,
  xOf,
  yOf,
  toUnit,
  handleAnchors,
  segmentBands,
  segmentAt,
  dragAttack,
  dragSustain,
  dragRelease,
  type Box,
} from './envelope-editor-geom';
import type { AdsrShape } from './sim';

/* S24 — pure handle↔shape geometry for the EnvelopeEditor. These are the helpers the
   spec requires unit-tested: the `.svelte` view is a thin shell over them, and S34's
   Envelope node inspector reuses the same seam. */

const base: AdsrShape = { attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.25 };

describe('coordinate mapping', () => {
  it('xOf/yOf map the unit corners to the padded viewBox', () => {
    expect(xOf(0)).toBe(GEO.PAD);
    expect(xOf(1)).toBe(GEO.W - GEO.PAD);
    expect(yOf(0)).toBe(GEO.H - GEO.PAD); // v=0 at the bottom
    expect(yOf(1)).toBe(GEO.PAD); //         v=1 at the top
  });

  it('toUnit inverts a pointer over the SVG box (1:1 box → viewBox)', () => {
    const rect: Box = { left: 0, top: 0, width: GEO.W, height: GEO.H };
    // Centre of the drawable area ≈ (t 0.5, v 0.5).
    const mid = toUnit(xOf(0.5), yOf(0.5), rect);
    expect(mid.t).toBeCloseTo(0.5, 10);
    expect(mid.v).toBeCloseTo(0.5, 10);
  });

  it('toUnit accounts for a scaled + offset box and clamps out-of-bounds', () => {
    const rect: Box = { left: 100, top: 50, width: GEO.W * 2, height: GEO.H * 2 };
    // A point far past the bottom-right clamps to (1, 0), never outside 0..1.
    const oob = toUnit(100 + GEO.W * 4, 50 + GEO.H * 4, rect);
    expect(oob.t).toBe(1);
    expect(oob.v).toBe(0);
    const topLeft = toUnit(100, 50, rect);
    expect(topLeft.t).toBe(0); // PAD maps just inside; the corner clamps to 0
    expect(topLeft.v).toBe(1);
  });
});

describe('handleAnchors', () => {
  it('places each handle at its sampling boundary', () => {
    const h = handleAnchors({ ...base, attackLevel: 1 });
    expect(h.attack).toEqual({ t: 0.2, v: 1 });
    expect(h.sustain).toEqual({ t: 0.5, v: 0.5 }); // attack+decay, sustain level
    expect(h.release).toEqual({ t: 0.75, v: 0.5 }); // 1-release, tracks sustain
  });

  it('reflects a lowered attackLevel on the attack handle Y (v2)', () => {
    expect(handleAnchors({ ...base, attackLevel: 0.4 }).attack.v).toBe(0.4);
  });

  it('defaults a missing attackLevel to 1', () => {
    expect(handleAnchors(base).attack.v).toBe(1);
  });
});

describe('segmentBands / segmentAt', () => {
  it('bands are contiguous, monotonic, and exclude the sustain plateau', () => {
    const b = segmentBands(base);
    expect(b.attack).toEqual([0, 0.2]);
    expect(b.decay).toEqual([0.2, 0.5]);
    expect(b.release).toEqual([0.75, 1]);
    // The gap [0.5, 0.75] is the flat sustain plateau — no ease, no band.
  });

  it('classifies a phase into its segment (or null on the plateau)', () => {
    expect(segmentAt(base, 0.1)).toBe('attack');
    expect(segmentAt(base, 0.35)).toBe('decay');
    expect(segmentAt(base, 0.6)).toBeNull(); // sustain plateau
    expect(segmentAt(base, 0.9)).toBe('release');
    // Boundaries resolve to the earlier segment.
    expect(segmentAt(base, 0.2)).toBe('attack');
    expect(segmentAt(base, 0.5)).toBe('decay');
  });
});

describe('dragAttack (X = time, Y = attackLevel)', () => {
  it('sets attackLevel from Y and holds the sustain point X fixed', () => {
    const sustainTBefore = base.attack + base.decay; // 0.5
    const patch = dragAttack(base, 0.3, 0.7);
    expect(patch.attackLevel).toBe(0.7);
    expect(patch.attack).toBe(0.3);
    // decay recomputed so attack+decay is unchanged → sustain node doesn't jump.
    expect(patch.attack! + patch.decay!).toBeCloseTo(sustainTBefore, 12);
  });

  it('clamps attack so it never passes the sustain/release nodes (or 0.9)', () => {
    const patch = dragAttack(base, 0.99, 0.5);
    expect(patch.attack).toBeLessThanOrEqual(Math.min(0.9, base.attack + base.decay, 1 - base.release));
    expect(patch.decay).toBeGreaterThanOrEqual(0);
  });

  it('clamps attackLevel to 0..1', () => {
    expect(dragAttack(base, 0.1, 1.5).attackLevel).toBe(1);
    expect(dragAttack(base, 0.1, -0.5).attackLevel).toBe(0);
  });
});

describe('dragSustain (X = decay, Y = level)', () => {
  it('sets decay relative to attack and the sustain level from Y', () => {
    const patch = dragSustain(base, 0.6, 0.3);
    expect(patch.decay).toBeCloseTo(0.6 - base.attack, 12);
    expect(patch.sustain).toBe(0.3);
  });

  it('clamps decay so the sustain node stays between attack and release nodes', () => {
    const patch = dragSustain(base, 0.99, 0.5);
    expect(base.attack + patch.decay!).toBeLessThanOrEqual(1 - base.release + 1e-9);
    expect(patch.decay).toBeGreaterThanOrEqual(0);
  });
});

describe('dragRelease (X only)', () => {
  it('maps X to release length', () => {
    // Drag the release node to t=0.8 → release = 1 - 0.8 = 0.2.
    expect(dragRelease(base, 0.8).release).toBeCloseTo(0.2, 12);
  });

  it('clamps release into 0..0.9 and never before the sustain node', () => {
    expect(dragRelease(base, 1).release).toBe(0); // node at the far right
    expect(dragRelease(base, 0).release).toBeLessThanOrEqual(0.9);
  });
});
