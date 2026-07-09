import { describe, expect, it } from 'vitest';
import { gapIndexAt, type RowExtent } from './sections-dnd';

// Three 40px rows stacked from y=100 with no gaps: [100,140), [140,180), [180,220).
const rows: RowExtent[] = [
  { top: 100, height: 40 },
  { top: 140, height: 40 },
  { top: 180, height: 40 },
];

describe('gapIndexAt', () => {
  it('returns 0 when the pointer is above the first row', () => {
    expect(gapIndexAt(rows, 0)).toBe(0);
    expect(gapIndexAt(rows, 100)).toBe(0);
  });

  it('inserts before a row while the pointer is in its top half', () => {
    expect(gapIndexAt(rows, 119)).toBe(0); // above row 0 midpoint (120)
    expect(gapIndexAt(rows, 159)).toBe(1); // above row 1 midpoint (160)
  });

  it('inserts after a row once the pointer crosses its midpoint', () => {
    expect(gapIndexAt(rows, 120)).toBe(1); // at row 0 midpoint → next gap
    expect(gapIndexAt(rows, 161)).toBe(2); // past row 1 midpoint
  });

  it('returns rows.length when the pointer is below the last row', () => {
    expect(gapIndexAt(rows, 210)).toBe(3);
    expect(gapIndexAt(rows, 9999)).toBe(3);
  });

  it('returns 0 for an empty list (only gap is the start)', () => {
    expect(gapIndexAt([], 500)).toBe(0);
  });
});
