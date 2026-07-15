/* Alignment guides for a free-form node canvas (the Trigger graph) — the PURE geometry behind
   "snap the dragged node to its neighbours' edges". No Svelte / DOM here so the snapping maths is
   unit-testable; the view feeds it the live rects on each drag frame and draws the returned guide
   lines (AlignGuides.svelte) in flow coordinates.

   It compares the dragged node's LEFT / CENTRE / RIGHT against every other node's LEFT / CENTRE /
   RIGHT (independently on X and Y). The nearest match within `threshold` (flow px) wins per axis,
   the node's top-left is snapped so that anchor lines up exactly, and a guide line is emitted along
   the shared edge spanning both nodes — the same behaviour as xyflow's "helper lines" example,
   distilled to a single pure function. */

/** A node rectangle in FLOW coordinates (top-left origin). */
export interface AlignRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guide line to draw, in FLOW coordinates. `v` = vertical at x=`pos` from y=`from`..`to`;
    `h` = horizontal at y=`pos` from x=`from`..`to`. */
export interface GuideLine {
  orient: 'v' | 'h';
  pos: number;
  from: number;
  to: number;
}

export interface AlignResult {
  /** The dragged node's snapped top-left (unchanged on the axis with no match). */
  x: number;
  y: number;
  /** 0–2 guide lines (one per snapped axis) to render while the drag holds. */
  guides: GuideLine[];
}

/** Default snap distance (flow px) — how close an edge must come before it locks. */
export const ALIGN_THRESHOLD = 6;

interface AxisMatch {
  dist: number;
  /** Snapped top-left coordinate on this axis. */
  snap: number;
  /** The shared line coordinate (the aligned edge). */
  line: number;
  /** The line's span on the OTHER axis (min..max across both nodes). */
  from: number;
  to: number;
}

/**
 * Snap `dragged` to align with any `others` edge/centre within `threshold`. Returns the (possibly
 * snapped) top-left plus the guide lines for the snapped axes. X and Y are resolved independently:
 * a node can snap its left edge to one neighbour and its middle to another. Nearest match wins; ties
 * keep the first seen (deterministic). `dragged` is excluded from `others` by id.
 */
export function computeAlignment(
  dragged: AlignRect,
  others: ReadonlyArray<AlignRect>,
  threshold: number = ALIGN_THRESHOLD,
): AlignResult {
  // Dragged anchors and the top-left offset that realises each (left→0, centre→w/2, right→w).
  const anchorsX = [dragged.x, dragged.x + dragged.w / 2, dragged.x + dragged.w];
  const anchorsY = [dragged.y, dragged.y + dragged.h / 2, dragged.y + dragged.h];
  const offX = [0, dragged.w / 2, dragged.w];
  const offY = [0, dragged.h / 2, dragged.h];

  let bestX: AxisMatch | null = null;
  let bestY: AxisMatch | null = null;

  for (const o of others) {
    if (o.id === dragged.id) continue;
    const oX = [o.x, o.x + o.w / 2, o.x + o.w];
    const oY = [o.y, o.y + o.h / 2, o.y + o.h];
    const spanX: [number, number] = [Math.min(dragged.y, o.y), Math.max(dragged.y + dragged.h, o.y + o.h)];
    const spanY: [number, number] = [Math.min(dragged.x, o.x), Math.max(dragged.x + dragged.w, o.x + o.w)];

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dx = Math.abs(anchorsX[i]! - oX[j]!);
        if (dx <= threshold && (bestX === null || dx < bestX.dist)) {
          bestX = { dist: dx, snap: oX[j]! - offX[i]!, line: oX[j]!, from: spanX[0], to: spanX[1] };
        }
        const dy = Math.abs(anchorsY[i]! - oY[j]!);
        if (dy <= threshold && (bestY === null || dy < bestY.dist)) {
          bestY = { dist: dy, snap: oY[j]! - offY[i]!, line: oY[j]!, from: spanY[0], to: spanY[1] };
        }
      }
    }
  }

  const guides: GuideLine[] = [];
  if (bestX) guides.push({ orient: 'v', pos: bestX.line, from: bestX.from, to: bestX.to });
  if (bestY) guides.push({ orient: 'h', pos: bestY.line, from: bestY.from, to: bestY.to });

  return {
    x: bestX ? bestX.snap : dragged.x,
    y: bestY ? bestY.snap : dragged.y,
    guides,
  };
}
