import { describe, expect, it } from 'vitest';
import { findFreePosition, type Rect } from './node-placement';

const W = 176;
const H = 90;

describe('findFreePosition', () => {
  it('returns the desired point when nothing occupies it', () => {
    expect(findFreePosition([], 100, 50, W, H)).toEqual({ x: 100, y: 50 });
  });

  it('moves off an occupied point', () => {
    const occupied: Rect[] = [{ x: 100, y: 50, w: W, h: H }];
    const p = findFreePosition(occupied, 100, 50, W, H);
    expect(p).not.toEqual({ x: 100, y: 50 });
    // the returned rect must not overlap the occupied one (incl. the gap)
    expect(p.x >= 100 + W + 16 || p.x + W + 16 <= 100 || p.y >= 50 + H + 16 || p.y + H + 16 <= 50).toBe(true);
  });

  it('repeated adds at the same point never stack', () => {
    const occupied: Rect[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const p = findFreePosition(occupied, 0, 0, W, H);
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      occupied.push({ x: p.x, y: p.y, w: W, h: H });
    }
  });

  it('is deterministic', () => {
    const occupied: Rect[] = [{ x: 0, y: 0, w: W, h: H }];
    expect(findFreePosition(occupied, 0, 0, W, H)).toEqual(findFreePosition(occupied, 0, 0, W, H));
  });

  it('falls back to the desired point on a pathologically dense canvas', () => {
    const occupied: Rect[] = [{ x: -5000, y: -5000, w: 10000, h: 10000 }];
    expect(findFreePosition(occupied, 0, 0, W, H)).toEqual({ x: 0, y: 0 });
  });
});
