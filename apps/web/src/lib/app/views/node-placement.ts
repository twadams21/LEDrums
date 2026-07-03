/* Free-position probe for palette node adds (phase-2 item 1.5). Every palette / modal add
   used to drop the new node at the exact viewport centre, so repeated adds stacked on the
   same point — and a node landing exactly on an existing one stole its pointer events (the
   "corrupted Delay node" illusion). Pure (no runes/DOM) so the probe is unit-tested: given
   the occupied node rects, walk outward from the desired point in a grid spiral and return
   the first position whose rect overlaps nothing. */

export type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Find a position for a `w`×`h` node near `(x, y)` that does not overlap any of `occupied`
    (each grown by `gap` so neighbours keep breathing room). Probes the desired point first,
    then an expanding ring walk in `step`-sized increments — deterministic, so repeated adds
    fan out in a stable, predictable pattern. Falls back to the desired point if every probe
    within `maxRings` collides (a pathologically dense canvas). */
export function findFreePosition(
  occupied: ReadonlyArray<Rect>,
  x: number,
  y: number,
  w: number,
  h: number,
  gap = 16,
  step = 48,
  maxRings = 12,
): { x: number; y: number } {
  const grown = occupied.map((r) => ({ x: r.x - gap, y: r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2 }));
  const free = (px: number, py: number): boolean => !grown.some((r) => overlaps({ x: px, y: py, w, h }, r));
  if (free(x, y)) return { x, y };
  for (let ring = 1; ring <= maxRings; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // ring perimeter only
        const px = x + dx * step;
        const py = y + dy * step;
        if (free(px, py)) return { x: px, y: py };
      }
    }
  }
  return { x, y };
}
