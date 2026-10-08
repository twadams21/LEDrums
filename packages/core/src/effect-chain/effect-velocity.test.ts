/* A Control driving the Effect itself — its Opacity and its brightness envelope (Tim, 2026-10-07:
   "being able to have velocity for the opacity of an effect would be great … the sustain on the
   brightness envelope that would be cool to change with velocity"). Set at the fire, so only a
   Velocity or Random Control can; the same rule as any mapping. */
import { describe, expect, it } from 'vitest';
import { effectPlayAction } from './resolver';
import { EFFECT_DEVICE, parseEffect } from './types';

const fire = (velocity: number, mappings: Record<string, unknown>[], extra: Record<string, unknown> = {}, kind = 'velocity') =>
  effectPlayAction(
    parseEffect({
      id: 'e', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'solid', style: 'solid' },
      amp: { attackMs: 100, length: { ms: 1000 }, releaseMs: 400 },
      controls: [{ uid: 'c', kind, mappings }],
      ...extra,
    }),
    { velocity, sourceDrumId: 'kick', bpm: 120, layerOrder: 0 },
  )!;

describe('a Velocity Control on the Effect itself', () => {
  it('Opacity follows how hard the hit is, across its Min…Max', () => {
    const map = [{ device: EFFECT_DEVICE, param: 'opacity', rangeMin: 0.2, rangeMax: 1 }];
    expect(fire(1, map).opacity).toBeCloseTo(1);
    expect(fire(0, map).opacity).toBeCloseTo(0.2);
    expect(fire(0.5, map).opacity).toBeCloseTo(0.6);
  });

  it('Sustain: a harder hit stays up longer (the length from the hit, Attack included)', () => {
    const map = [{ device: EFFECT_DEVICE, param: 'sustain', rangeMin: 200, rangeMax: 2000 }];
    expect(fire(1, map).sustainMs).toBeCloseTo(2000 - 100);
    expect(fire(0, map).sustainMs).toBeCloseTo(200 - 100);
  });

  it('Attack and Decay, inverted — a harder hit snaps in and cuts off sooner', () => {
    const map = [
      { device: EFFECT_DEVICE, param: 'attack', rangeMin: 0, rangeMax: 500, invert: true },
      { device: EFFECT_DEVICE, param: 'decay', rangeMin: 0, rangeMax: 1000, invert: true },
    ];
    expect(fire(1, map)).toMatchObject({ attackMs: 0, releaseMs: 0 });
    expect(fire(0, map)).toMatchObject({ attackMs: 500, releaseMs: 1000 });
  });

  it('Amount blends towards it; nothing mapped leaves the Effect as authored', () => {
    expect(fire(0, [{ device: EFFECT_DEVICE, param: 'opacity', rangeMin: 0, rangeMax: 1, amount: 0.5 }]).opacity).toBeCloseTo(0.5);
    expect(fire(0, []).opacity).toBe(1);
  });

  it('only a Control fixed at the hit can drive it — an LFO cannot', () => {
    expect(fire(0, [{ device: EFFECT_DEVICE, param: 'opacity', rangeMin: 0, rangeMax: 1 }], {}, 'lfo').opacity).toBe(1);
  });

  it('Sustain moves only a timed envelope — not While held or Loop', () => {
    const map = [{ device: EFFECT_DEVICE, param: 'sustain', rangeMin: 0, rangeMax: 5000 }];
    expect(fire(1, map, { amp: { attackMs: 0, length: 'hold', releaseMs: 0 } })).toMatchObject({ mode: 'hold', sustainMs: 0 });
  });
});
