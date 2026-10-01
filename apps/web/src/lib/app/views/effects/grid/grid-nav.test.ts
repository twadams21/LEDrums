import { describe, expect, it } from 'vitest';
import { MASTER_COL, focusable, initialFocus, moveFocus, type GridShape } from './grid-nav';

/* Kit row (0): zone columns 0–1 disabled, Always/Clock/Cue (2–4) enabled.
   Kick (1): every column. Snare (2): zone 1 missing. */
const shape: GridShape = {
  rows: 3,
  cols: 5,
  enabled: (r, c) => (r === 0 ? c >= 2 : !(r === 2 && c === 1)),
};

describe('grid roving focus', () => {
  it('only the Kit row carries the Master cell', () => {
    expect(focusable(shape, { row: 0, col: MASTER_COL })).toBe(true);
    expect(focusable(shape, { row: 1, col: MASTER_COL })).toBe(false);
  });

  it('ArrowRight / ArrowLeft skip disabled cells, and the Kit row steps onto the Master', () => {
    expect(moveFocus(shape, { row: 2, col: 0 }, 'ArrowRight')).toEqual({ row: 2, col: 2 });
    expect(moveFocus(shape, { row: 0, col: 2 }, 'ArrowLeft')).toEqual({ row: 0, col: MASTER_COL });
    expect(moveFocus(shape, { row: 0, col: MASTER_COL }, 'ArrowRight')).toEqual({ row: 0, col: 2 });
  });

  it('does not move past either edge', () => {
    expect(moveFocus(shape, { row: 1, col: 0 }, 'ArrowLeft')).toEqual({ row: 1, col: 0 });
    expect(moveFocus(shape, { row: 1, col: 4 }, 'ArrowRight')).toEqual({ row: 1, col: 4 });
    expect(moveFocus(shape, { row: 0, col: 3 }, 'ArrowUp')).toEqual({ row: 0, col: 3 });
    expect(moveFocus(shape, { row: 2, col: 3 }, 'ArrowDown')).toEqual({ row: 2, col: 3 });
  });

  it('vertical moves land on the nearest enabled cell of the next row', () => {
    expect(moveFocus(shape, { row: 1, col: 1 }, 'ArrowDown')).toEqual({ row: 2, col: 0 });
    // Kit zone cells are disabled: going up from a zone lands on the nearest enabled Kit cell.
    expect(moveFocus(shape, { row: 1, col: 0 }, 'ArrowUp')).toEqual({ row: 0, col: MASTER_COL });
    expect(moveFocus(shape, { row: 1, col: 3 }, 'ArrowUp')).toEqual({ row: 0, col: 3 });
    expect(moveFocus(shape, { row: 0, col: MASTER_COL }, 'ArrowDown')).toEqual({ row: 1, col: 0 });
  });

  it('Home / End go to the row ends', () => {
    expect(moveFocus(shape, { row: 0, col: 3 }, 'Home')).toEqual({ row: 0, col: MASTER_COL });
    expect(moveFocus(shape, { row: 2, col: 0 }, 'End')).toEqual({ row: 2, col: 4 });
  });

  it('starts on the preferred position when it is focusable, else the first enabled cell', () => {
    expect(initialFocus(shape, { row: 2, col: 3 })).toEqual({ row: 2, col: 3 });
    expect(initialFocus(shape, { row: 2, col: 1 })).toEqual({ row: 0, col: 2 });
    expect(initialFocus(shape, null)).toEqual({ row: 0, col: 2 });
    expect(initialFocus({ rows: 1, cols: 2, enabled: () => false }, null)).toEqual({ row: 0, col: MASTER_COL });
  });
});
