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

export interface ColExtent {
  left: number;
  width: number;
}

/** Shared gap resolver along one axis: the pointer "passes" an extent once it crosses
    its midpoint, so the result is the ORIGINAL-list gap index (0..extents.length). */
function gapIndex(extents: readonly [number, number][], pos: number): number {
  for (let i = 0; i < extents.length; i++) {
    const [start, size] = extents[i]!;
    if (pos < start + size / 2) return i;
  }
  return extents.length;
}

/** Gap a dragged graph ROW would land in — pointer Y vs each row's vertical midpoint. */
export function gapIndexAt(rows: readonly RowExtent[], clientY: number): number {
  return gapIndex(
    rows.map((r) => [r.top, r.height]),
    clientY,
  );
}

/** Gap a dragged SECTION column would land in — pointer X vs each column's horizontal
    midpoint. The horizontal twin of {@link gapIndexAt}; the index feeds `moveSection`,
    which accounts for the source removal itself. */
export function columnGapIndexAt(cols: readonly ColExtent[], clientX: number): number {
  return gapIndex(
    cols.map((c) => [c.left, c.width]),
    clientX,
  );
}
