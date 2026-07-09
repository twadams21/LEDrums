/* Pure geometry for the Sections drag-and-drop insertion line.

   Given the vertical rects of a section's graph rows and the pointer's Y, resolve
   the gap index the dragged row would land in — 0 (before the first row) through
   `rows.length` (after the last). A row counts as "passed" once the pointer crosses
   its vertical midpoint, so the insertion line tracks the nearest gap. The result is
   an ORIGINAL-list gap index, which is exactly what `moveGraphPlacement` expects
   (it accounts for the source removal itself for same-section moves). */

export interface RowExtent {
  top: number;
  height: number;
}

export function gapIndexAt(rows: readonly RowExtent[], clientY: number): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (clientY < row.top + row.height / 2) return i;
  }
  return rows.length;
}
