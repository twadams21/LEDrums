import { describe, expect, it } from 'vitest';
import { computeAlignment, type AlignRect } from './align-guides';

const rect = (id: string, x: number, y: number, w = 100, h = 40): AlignRect => ({ id, x, y, w, h });

describe('computeAlignment', () => {
  it('snaps the LEFT edge to a neighbour left within threshold and emits a vertical guide', () => {
    const dragged = rect('a', 203, 300); // left edge 3px off neighbour's left (200)
    const r = computeAlignment(dragged, [rect('b', 200, 100)], 6);
    expect(r.x).toBe(200);
    expect(r.y).toBe(300); // no Y match
    expect(r.guides).toContainEqual(expect.objectContaining({ orient: 'v', pos: 200 }));
  });

  it('snaps CENTRE-to-centre on both axes (a node dropped near another node centre)', () => {
    // other centre at (250, 120); dragged 100x40 → centre at (x+50, y+20)
    const dragged = rect('a', 202, 102); // centre (252,122), 2px off (250,120)
    const r = computeAlignment(dragged, [rect('b', 200, 100)], 6);
    expect(r.x).toBe(200); // centre aligned → left back to 200
    expect(r.y).toBe(100);
    expect(r.guides).toHaveLength(2);
  });

  it('leaves position untouched and emits no guides when nothing is within threshold', () => {
    const dragged = rect('a', 500, 500);
    const r = computeAlignment(dragged, [rect('b', 0, 0)], 6);
    expect(r).toEqual({ x: 500, y: 500, guides: [] });
  });

  it('ignores itself in the others list', () => {
    const dragged = rect('a', 100, 100);
    const r = computeAlignment(dragged, [rect('a', 100, 100)], 6);
    expect(r.guides).toHaveLength(0);
  });

  it('the vertical guide spans both nodes on the Y axis', () => {
    const dragged = rect('a', 200, 400, 100, 40); // below the neighbour
    const r = computeAlignment(dragged, [rect('b', 200, 100, 100, 40)], 6);
    const v = r.guides.find((g) => g.orient === 'v')!;
    expect(v.from).toBe(100); // neighbour top
    expect(v.to).toBe(440); // dragged bottom
  });

  it('picks the NEAREST of several candidate edges', () => {
    const dragged = rect('a', 205, 300); // left 205
    // one neighbour left at 200 (5px), another right edge at 208 (3px) — nearer wins
    const r = computeAlignment(dragged, [rect('b', 200, 100), rect('c', 108, 100, 100, 40)], 6);
    expect(r.x).toBe(208); // snapped to the nearer edge (c's right = 208)
  });
});
