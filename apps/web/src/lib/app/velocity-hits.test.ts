import { describe, expect, it } from 'vitest';
import { appendVelocityHit, VELOCITY_HIT_LIMIT, type VelocityHits } from './velocity-hits';

describe('appendVelocityHit', () => {
  it('starts a drum’s buffer on its first hit', () => {
    const next = appendVelocityHit({}, 'kick', { x: 0.5, at: 100 });
    expect(next.kick).toEqual([{ x: 0.5, at: 100 }]);
  });

  it('keeps hits oldest-first and leaves other drums alone', () => {
    let hits: VelocityHits = {};
    hits = appendVelocityHit(hits, 'kick', { x: 0.2, at: 1 });
    hits = appendVelocityHit(hits, 'snare', { x: 0.9, at: 2 });
    hits = appendVelocityHit(hits, 'kick', { x: 0.4, at: 3 });
    expect(hits.kick).toEqual([{ x: 0.2, at: 1 }, { x: 0.4, at: 3 }]);
    expect(hits.snare).toEqual([{ x: 0.9, at: 2 }]);
  });

  it('caps the buffer, dropping the oldest', () => {
    let hits: VelocityHits = {};
    for (let i = 0; i < VELOCITY_HIT_LIMIT + 5; i += 1) {
      hits = appendVelocityHit(hits, 'kick', { x: i / 100, at: i });
    }
    expect(hits.kick).toHaveLength(VELOCITY_HIT_LIMIT);
    expect(hits.kick?.[0]).toEqual({ x: 0.05, at: 5 });
    expect(hits.kick?.[VELOCITY_HIT_LIMIT - 1]).toEqual({ x: 0.16, at: 16 });
  });

  it('honours a smaller limit', () => {
    let hits: VelocityHits = {};
    hits = appendVelocityHit(hits, 'kick', { x: 0.1, at: 1 }, 2);
    hits = appendVelocityHit(hits, 'kick', { x: 0.2, at: 2 }, 2);
    hits = appendVelocityHit(hits, 'kick', { x: 0.3, at: 3 }, 2);
    expect(hits.kick).toEqual([{ x: 0.2, at: 2 }, { x: 0.3, at: 3 }]);
  });

  it('never stores a y — the marker is read off the curve on screen', () => {
    const next = appendVelocityHit({}, 'kick', { x: 0.5, at: 1 });
    expect(next.kick?.[0]).not.toHaveProperty('y');
  });

  it('drops an unclaimed hit — no drum means no curve to plot it under', () => {
    const hits: VelocityHits = { kick: [{ x: 0.5, at: 1 }] };
    expect(appendVelocityHit(hits, undefined, { x: 0.9, at: 2 })).toBe(hits);
    expect(appendVelocityHit(hits, '', { x: 0.9, at: 2 })).toBe(hits);
  });

  it('returns a new map and a new array, so a $state reassign re-renders', () => {
    const hits: VelocityHits = { kick: [{ x: 0.5, at: 1 }] };
    const next = appendVelocityHit(hits, 'kick', { x: 0.6, at: 2 });
    expect(next).not.toBe(hits);
    expect(next.kick).not.toBe(hits.kick);
    expect(hits.kick).toHaveLength(1);
  });
});
