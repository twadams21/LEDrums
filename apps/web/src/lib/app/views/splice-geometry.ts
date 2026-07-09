/* Pure geometry for the R08 wire-splice arming: which existing wire (if any) the node the
   user is dragging currently overlaps. Kept free of Svelte/DOM/xyflow so the hit-test is
   unit-testable and the view stays thin (mirrors node-placement.ts).

   A wire is approximated by the straight segment from its source node's output edge
   (right-middle) to its target node's input edge (left-middle) — the real wire is a bezier,
   but for "is the dragged node sitting on this wire?" the chord is close enough and stable.
   Validity (can this splice legally happen?) is the STORE's call (`canSplice`); this only
   answers the spatial question. */

/** A node's canvas-space rectangle (flow coords: top-left origin, +y down). */
export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The two node ids a wire connects. */
export interface EdgeEnds {
  id: string;
  source: string;
  target: string;
}

interface Point {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Squared distance from point `p` to segment `a`–`b` (squared to avoid a sqrt in the hot path). */
function distSqToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** Do segments `p1`–`p2` and `p3`–`p4` cross? (standard orientation test). */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Does the wire segment `a`–`b` touch rectangle `r`? True if either end is inside the rect or
    the segment crosses any of the rect's four sides. */
function segmentHitsRect(a: Point, b: Point, r: NodeRect): boolean {
  const inside = (p: Point): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const br = { x: r.x + r.w, y: r.y + r.h };
  const bl = { x: r.x, y: r.y + r.h };
  return (
    segmentsCross(a, b, tl, tr) ||
    segmentsCross(a, b, tr, br) ||
    segmentsCross(a, b, br, bl) ||
    segmentsCross(a, b, bl, tl)
  );
}

/** The endpoint the wire leaves the source at (right-middle) and lands on the target at
    (left-middle) — the straight-chord approximation of the bezier. */
function wireEnds(src: NodeRect, tgt: NodeRect): { a: Point; b: Point } {
  return {
    a: { x: src.x + src.w, y: src.y + src.h / 2 },
    b: { x: tgt.x, y: tgt.y + tgt.h / 2 },
  };
}

/** Which wire does `dragged` currently overlap? Returns the id of the nearest overlapped edge
    (by distance from the dragged rect's centre to the wire chord), or `null` when none overlap.
    Edges whose source/target rect is unknown, or that touch the dragged node itself, are skipped —
    a node can't splice into its own wire. Pure. */
export function edgeUnderNode(
  draggedId: string,
  dragged: NodeRect,
  edges: readonly EdgeEnds[],
  rects: ReadonlyMap<string, NodeRect>,
): string | null {
  const centre: Point = { x: dragged.x + dragged.w / 2, y: dragged.y + dragged.h / 2 };
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const e of edges) {
    if (e.source === draggedId || e.target === draggedId) continue;
    const src = rects.get(e.source);
    const tgt = rects.get(e.target);
    if (!src || !tgt) continue;
    const { a, b } = wireEnds(src, tgt);
    if (!segmentHitsRect(a, b, dragged)) continue;
    const dist = distSqToSegment(centre, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = e.id;
    }
  }
  return bestId;
}
