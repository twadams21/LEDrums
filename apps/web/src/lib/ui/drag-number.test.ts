import { describe, expect, it } from 'vitest';
import { dragNumber, DRAG_TRAVEL_PX, DRAG_UNRANGED_PX_PER_STEP } from './drag-number';

/* The drag rule for the compact numeric face field. The property that matters most is
   idempotence: the caller re-evaluates from the SAME anchor on every pointermove, so a drag
   out and back must land exactly where it started — anything cumulative drifts. */

describe('dragNumber — ranged params', () => {
  it('sweeps the full range over DRAG_TRAVEL_PX', () => {
    expect(dragNumber({ start: 0, dx: DRAG_TRAVEL_PX, min: 0, max: 1, step: 0.01 })).toBe(1);
    expect(dragNumber({ start: 1, dx: -DRAG_TRAVEL_PX, min: 0, max: 1, step: 0.01 })).toBe(0);
  });

  it('normalizes sensitivity by RANGE, so a 0..1 and a 0..255 param feel the same', () => {
    const half = DRAG_TRAVEL_PX / 2;
    expect(dragNumber({ start: 0, dx: half, min: 0, max: 1, step: 0.01 })).toBe(0.5);
    expect(dragNumber({ start: 0, dx: half, min: 0, max: 255, step: 1 })).toBe(128);
  });

  it('clamps at both ends', () => {
    expect(dragNumber({ start: 0.5, dx: 5000, min: 0, max: 1, step: 0.01 })).toBe(1);
    expect(dragNumber({ start: 0.5, dx: -5000, min: 0, max: 1, step: 0.01 })).toBe(0);
  });

  it('returns the anchor exactly at dx=0 (a drag out and back is lossless)', () => {
    for (const start of [0, 0.33, 0.5, 1]) {
      expect(dragNumber({ start, dx: 0, min: 0, max: 1, step: 0.01 })).toBe(start);
    }
  });

  it('snaps to the step lattice anchored at `min`, not at zero', () => {
    // 1..10 step 0.5 — a value must land on 1.5, never on 1.25
    const v = dragNumber({ start: 1, dx: 12, min: 1, max: 10, step: 0.5 });
    expect(Number.isInteger(v * 2)).toBe(true);
  });

  it('never surfaces float noise (0.1 + 0.2 stays 0.3)', () => {
    expect(String(dragNumber({ start: 0.1, dx: DRAG_TRAVEL_PX * 0.2, min: 0, max: 1, step: 0.1 }))).toBe('0.3');
  });
});

describe('dragNumber — fine modifier', () => {
  it('moves a quarter as far with Shift held (to within one step of snapping)', () => {
    const coarse = dragNumber({ start: 0, dx: 100, min: 0, max: 1, step: 0.001 });
    const fine = dragNumber({ start: 0, dx: 100, min: 0, max: 1, step: 0.001, fine: true });
    expect(Math.abs(fine - coarse / 4)).toBeLessThanOrEqual(0.001);
  });
});

describe('dragNumber — unranged params', () => {
  it('falls back to one step per few px when there is no range to normalize against', () => {
    expect(dragNumber({ start: 100, dx: DRAG_UNRANGED_PX_PER_STEP * 10, step: 5 })).toBe(150);
    expect(dragNumber({ start: 100, dx: -DRAG_UNRANGED_PX_PER_STEP * 4, step: 5 })).toBe(80);
  });

  it('defaults to a step of 1', () => {
    expect(dragNumber({ start: 0, dx: DRAG_UNRANGED_PX_PER_STEP * 3 })).toBe(3);
  });

  it('honours a one-sided bound', () => {
    expect(dragNumber({ start: 2, dx: -1000, min: 0 })).toBe(0);
    expect(dragNumber({ start: 2, dx: 1000, max: 9 })).toBe(9);
  });

  it('recovers from a non-finite anchor rather than producing NaN', () => {
    expect(dragNumber({ start: Number.NaN, dx: 8, min: 0, max: 10, step: 1 })).toBe(0);
  });
});
