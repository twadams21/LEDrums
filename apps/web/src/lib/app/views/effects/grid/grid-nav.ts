/* Roving-focus model for the Effects grid — pure, so the keyboard contract is pinned without a DOM.

   A position is (row index, column index) into the grid's rows × columns. Column -1 is the
   Master cell, which exists only on row 0 (the Kit row) — it sits at the Kit row's start, so
   ArrowLeft off the Kit row's first cell lands on it. Disabled cells are never landed on:
   horizontal moves skip over them, vertical moves land on the nearest enabled cell of the next
   row that has one. A move with nowhere to go returns the position unchanged. */

export interface GridPos {
  row: number;
  col: number;
}

export const MASTER_COL = -1;

export interface GridShape {
  rows: number;
  cols: number;
  /** Whether a real cell (col ≥ 0) can take focus. */
  enabled(row: number, col: number): boolean;
}

export type GridNavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const NAV_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function isGridNavKey(key: string): key is GridNavKey {
  return NAV_KEYS.has(key);
}

/** Whether a position can take focus: the Master on row 0, or an enabled in-range cell. */
export function focusable(shape: GridShape, pos: GridPos): boolean {
  if (pos.row < 0 || pos.row >= shape.rows) return false;
  if (pos.col === MASTER_COL) return pos.row === 0;
  return pos.col >= 0 && pos.col < shape.cols && shape.enabled(pos.row, pos.col);
}

function firstCol(row: number): number {
  return row === 0 ? MASTER_COL : 0;
}

/** Nearest focusable column in `row` to `col` (ties go left); null when the row has none. */
function nearestInRow(shape: GridShape, row: number, col: number): number | null {
  const lo = firstCol(row);
  for (let d = 0; d <= shape.cols; d++) {
    if (col - d >= lo && focusable(shape, { row, col: col - d })) return col - d;
    if (col + d < shape.cols && focusable(shape, { row, col: col + d })) return col + d;
  }
  return null;
}

/** Where a navigation key moves focus from `pos`. */
export function moveFocus(shape: GridShape, pos: GridPos, key: GridNavKey): GridPos {
  const { row, col } = pos;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      const step = key === 'ArrowRight' ? 1 : -1;
      for (let c = col + step; c >= firstCol(row) && c < shape.cols; c += step) {
        if (focusable(shape, { row, col: c })) return { row, col: c };
      }
      return pos;
    }
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = key === 'ArrowDown' ? 1 : -1;
      // The Master column has one cell; moving vertically off it continues from column 0.
      const from = col === MASTER_COL ? 0 : col;
      for (let r = row + step; r >= 0 && r < shape.rows; r += step) {
        const c = nearestInRow(shape, r, from);
        if (c !== null) return { row: r, col: c };
      }
      return pos;
    }
    case 'Home':
    case 'End': {
      const cols = [];
      for (let c = firstCol(row); c < shape.cols; c++) if (focusable(shape, { row, col: c })) cols.push(c);
      const target = key === 'Home' ? cols[0] : cols.at(-1);
      return target === undefined ? pos : { row, col: target };
    }
  }
}

/** A focusable position to start from: `preferred` when it still is one, else the first
    enabled cell in reading order, else the Master. */
export function initialFocus(shape: GridShape, preferred: GridPos | null): GridPos {
  if (preferred && focusable(shape, preferred)) return preferred;
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++) if (shape.enabled(r, c)) return { row: r, col: c };
  }
  return { row: 0, col: MASTER_COL };
}
