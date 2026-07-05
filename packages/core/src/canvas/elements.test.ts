import { describe, expect, it } from 'vitest';
import { elementAt, sceneColorAt } from './elements';
import type { CanvasElement } from './types';

const scratch: [number, number, number] = [0, 0, 0];

const stripes = (over: Partial<Extract<CanvasElement, { kind: 'stripes' }>> = {}): CanvasElement => ({
  kind: 'stripes',
  angleDeg: 0,
  widthU: 0.5,
  duty: 0.5,
  speedUps: 0,
  hue: 0,
  sat: 0, // white → r=g=b=1, easy assertions
  softness: 0,
  ...over,
});

describe('canvas elements — pure renderers', () => {
  it('stripes: lit inside the duty band, dark outside, hard edges at softness 0', () => {
    const el = stripes(); // period 0.5 along +u from centre: phase = (u-0.5)/0.5 mod 1
    expect(elementAt(0.6, 0.5, 0, el)![3]).toBe(1); // phase 0.2 < duty
    expect(elementAt(0.9, 0.5, 0, el)).toBeNull(); //  phase 0.8 ≥ duty
  });

  it('stripes: speedUps drifts the pattern over time deterministically', () => {
    const el = stripes({ speedUps: 0.25 }); // after 1s the phase shifts by 0.5 → dark↔lit swap
    const t0 = elementAt(0.9, 0.5, 0, el);
    const t1 = elementAt(0.9, 0.5, 1, el);
    expect(t0).toBeNull();
    expect(t1![3]).toBe(1);
    // pure fn: same inputs, same output
    expect(elementAt(0.9, 0.5, 1, el)).toEqual(t1);
  });

  it('stripes: angleDeg 90 runs the pattern along v instead of u', () => {
    const el = stripes({ angleDeg: 90 });
    expect(elementAt(0.5, 0.6, 0, el)![3]).toBe(1);
    expect(elementAt(0.5, 0.9, 0, el)).toBeNull();
  });

  it('circle: full coverage at centre, feathered at the rim, null outside', () => {
    const el: CanvasElement = { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.2, feather: 0.1, hue: 120, sat: 1 };
    expect(elementAt(0.5, 0.5, 0, el)![3]).toBe(1);
    const rim = elementAt(0.5 + 0.15, 0.5, 0, el)!; // inside the feather band
    expect(rim[3]).toBeGreaterThan(0);
    expect(rim[3]).toBeLessThan(1);
    expect(elementAt(0.9, 0.5, 0, el)).toBeNull();
  });

  it('gradient: interpolates stops along its axis', () => {
    const el: CanvasElement = {
      kind: 'gradient',
      angleDeg: 0,
      stops: [
        { at: 0, hue: 0, sat: 0, v: 0 },
        { at: 1, hue: 0, sat: 0, v: 1 },
      ],
    };
    expect(elementAt(0, 0.5, 0, el)![0]).toBeCloseTo(0, 5);
    expect(elementAt(1, 0.5, 0, el)![0]).toBeCloseTo(1, 5);
    expect(elementAt(0.5, 0.5, 0, el)![0]).toBeCloseTo(0.5, 5);
  });

  it('polygon: inside lit, outside null; rotation moves the vertices', () => {
    const el: CanvasElement = { kind: 'polygon', cx: 0.5, cy: 0.5, sides: 4, r: 0.2, rotDeg: 0, feather: 0, hue: 0, sat: 0 };
    expect(elementAt(0.5, 0.5, 0, el)![3]).toBe(1);
    expect(elementAt(0.95, 0.5, 0, el)).toBeNull();
    // a square (vertices at 0/90/180/270°) reaches r on-axis but only r·cos45 at the edge midpoints
    expect(elementAt(0.5 + 0.19, 0.5, 0, el)![3]).toBe(1); // just inside the on-axis vertex
    const rotated: CanvasElement = { ...el, rotDeg: 45 };
    expect(elementAt(0.5 + 0.19, 0.5, 0, rotated)).toBeNull(); // midpoint of an edge now (r·cos45 ≈ 0.14)
  });

  it('checker: alternates hueA/hueB cells; phase shifts columns', () => {
    const el: CanvasElement = { kind: 'checker', cols: 2, rows: 2, hueA: 0, hueB: 120, phase: 0 };
    const a = elementAt(0.25, 0.25, 0, el)!; // cell (0,0) → hueA (red)
    const b = elementAt(0.75, 0.25, 0, el)!; // cell (1,0) → hueB (green)
    expect(a[0]).toBeCloseTo(1, 5);
    expect(b[1]).toBeCloseTo(1, 5);
    const shifted: CanvasElement = { ...el, phase: 0.5 }; // one column over
    expect(elementAt(0.25, 0.25, 0, shifted)![1]).toBeCloseTo(1, 5);
  });

  it('noise: deterministic, in range, animated by speed', () => {
    const el: CanvasElement = { kind: 'noise', scale: 4, octaves: 3, hue: 0, sat: 0, speed: 1 };
    const s1 = elementAt(0.3, 0.7, 0.5, el)!;
    const s2 = elementAt(0.3, 0.7, 0.5, el)!;
    expect(s1).toEqual(s2);
    for (const c of s1) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(elementAt(0.3, 0.7, 2.0, el)![0]).not.toBeCloseTo(s1[0], 5);
  });
});

describe('sceneColorAt — painter order compositing', () => {
  it('later elements paint over earlier ones; coverage accumulates alpha-over', () => {
    const below: CanvasElement = { kind: 'gradient', angleDeg: 0, stops: [{ at: 0, hue: 0, sat: 1, v: 1 }, { at: 1, hue: 0, sat: 1, v: 1 }] }; // solid red
    const above: CanvasElement = { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.2, feather: 0, hue: 120, sat: 1 }; // green disc
    // inside the disc → green wins
    let cov = sceneColorAt([below, above], 0.5, 0.5, 0, scratch);
    expect(cov).toBe(1);
    expect(scratch[1]).toBeCloseTo(1, 5);
    expect(scratch[0]).toBeCloseTo(0, 5);
    // outside the disc → the red base shows
    cov = sceneColorAt([below, above], 0.9, 0.9, 0, scratch);
    expect(cov).toBe(1);
    expect(scratch[0]).toBeCloseTo(1, 5);
  });

  it('no element coverage → 0 (pixel stays untouched)', () => {
    const disc: CanvasElement = { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.1, feather: 0, hue: 0, sat: 1 };
    expect(sceneColorAt([disc], 0.9, 0.9, 0, scratch)).toBe(0);
  });
});
