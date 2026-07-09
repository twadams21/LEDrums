import { describe, expect, it } from 'vitest';
import { columnGapIndexAt, gapIndexAt, type ColExtent, type RowExtent } from './sections-dnd';

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

// Three 200px columns stacked from x=100 with no gaps: [100,300), [300,500), [500,700).
const cols: ColExtent[] = [
  { left: 100, width: 200 },
  { left: 300, width: 200 },
  { left: 500, width: 200 },
];

describe('columnGapIndexAt', () => {
  it('returns 0 when the pointer is left of the first column', () => {
    expect(columnGapIndexAt(cols, 0)).toBe(0);
    expect(columnGapIndexAt(cols, 199)).toBe(0); // left of column 0 midpoint (200)
  });

  it('inserts after a column once the pointer crosses its midpoint', () => {
    expect(columnGapIndexAt(cols, 200)).toBe(1); // at column 0 midpoint → next gap
    expect(columnGapIndexAt(cols, 401)).toBe(2); // past column 1 midpoint (400)
  });

  it('returns cols.length when the pointer is right of the last column', () => {
    expect(columnGapIndexAt(cols, 650)).toBe(3);
    expect(columnGapIndexAt(cols, 9999)).toBe(3);
  });

  it('returns 0 for an empty row (only gap is the start)', () => {
    expect(columnGapIndexAt([], 500)).toBe(0);
  });
});
