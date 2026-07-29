import { describe, expect, it } from 'vitest';
import { model, transport, ctx, trig, render, litCount, finite01Failures } from '../test-support/effect-harness';
import { type EffectGenerator } from './types';
import { starfield } from './impl/starfield';
import { cometTrails } from './impl/comet-trails';
import { lightning } from './impl/lightning';
import { confettiBurst } from './impl/confetti-burst';
import { helix } from './impl/helix';
import { orbitRings } from './impl/orbit-rings';

const batchC: EffectGenerator<unknown>[] = [starfield, cometTrails, lightning, confettiBurst, helix, orbitRings];

describe('batch-c: all six render finite [0,1]', () => {
  it('never emit NaN or out-of-range channel values', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 0.8, 30), trig(2, 'd1', 38, 1, 120)];
    for (const e of batchC) {
      const fb = render(e, m, ctx(m, { timeMs: 250, transport: transport(2.3, 250), triggers }));
      expect(finite01Failures(fb, e.id)).toEqual([]);
    }
  });
});

describe('starfield', () => {
  it('lights stars at a non-trivial time and advances across ticks', () => {
    const m = model(2);
    const state = starfield.createState!(m);
    const a = render(starfield, m, ctx(m, { timeMs: 120, dt: 16 }), { count: 40, rate: 3 }, state);
    expect(litCount(a)).toBeGreaterThan(0);
    expect(finite01Failures(a, 'starfield')).toEqual([]);
    // Drive a second tick on the same state; still finite and lit.
    const b = render(starfield, m, ctx(m, { timeMs: 260, dt: 16 }), { count: 40, rate: 3 }, state);
    expect(litCount(b)).toBeGreaterThan(0);
    expect(finite01Failures(b, 'starfield')).toEqual([]);
  });

  it('is seed-deterministic for the same star layout', () => {
    const m = model(2);
    const s1 = starfield.createState!(m);
    const s2 = starfield.createState!(m);
    const a = render(starfield, m, ctx(m, { timeMs: 200 }), {}, s1);
    const b = render(starfield, m, ctx(m, { timeMs: 200 }), {}, s2);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });
});

describe('comet-trails', () => {
  it('lights pixels and advances the comet over successive ticks', () => {
    const m = model(2, 4);
    const state = cometTrails.createState!(m);
    const params = { comets: 4, speed: 360, tail: 150 };
    // First tick at t=0 establishes positions.
    let fb = render(cometTrails, m, ctx(m, { timeMs: 0, dt: 16 }), params, state);
    // Drive several ticks so heads orbit; the comet should light pixels.
    for (let f = 1; f <= 5; f++) {
      fb = render(cometTrails, m, ctx(m, { timeMs: f * 100, dt: 100 }), params, state);
    }
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(finite01Failures(fb, 'comet-trails')).toEqual([]);
  });
});

describe('lightning', () => {
  it('lights >0 pixels on a fresh trigger and is per-hit deterministic', () => {
    const m = model(2);
    const fb = render(lightning, m, ctx(m, { triggers: [trig(7, 'd0', 36, 1, 0)] }), { boltWidth: 200 });
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(finite01Failures(fb, 'lightning')).toEqual([]);
    // Same seq → identical bolt.
    const again = render(lightning, m, ctx(m, { triggers: [trig(7, 'd0', 36, 1, 0)] }), { boltWidth: 200 });
    expect(Array.from(again.rgba)).toEqual(Array.from(fb.rgba));
  });

  it('fades to nothing once the trigger is old', () => {
    const m = model(1);
    const old = render(lightning, m, ctx(m, { triggers: [trig(1, 'd0', 36, 1, 5000)] }), { decayMs: 150 });
    expect(litCount(old)).toBe(0);
  });
});

describe('confetti-burst', () => {
  it('spawns particles on a trigger and lights pixels as they advance', () => {
    const m = model(2);
    const state = confettiBurst.createState!(m);
    const params = { count: 32, spread: 1.0, gravity: 0.002, life: 4000 };
    // Trigger spawns particles; advance a few ticks so they reach pixels.
    let fb = render(confettiBurst, m, ctx(m, { dt: 16, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, state);
    for (let f = 1; f <= 6; f++) {
      fb = render(confettiBurst, m, ctx(m, { timeMs: f * 60, dt: 60, triggers: [] }), params, state);
    }
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(finite01Failures(fb, 'confetti-burst')).toEqual([]);
  });

  it('is seed-deterministic across two engines fed the same hit', () => {
    const m = model(2);
    const s1 = confettiBurst.createState!(m);
    const s2 = confettiBurst.createState!(m);
    const params = { count: 16, life: 4000 };
    const drive = (s: typeof s1) => {
      let fb = render(confettiBurst, m, ctx(m, { dt: 16, triggers: [trig(1, 'd0', 36, 1, 0)] }), params, s);
      for (let f = 1; f <= 4; f++) {
        fb = render(confettiBurst, m, ctx(m, { timeMs: f * 60, dt: 60, triggers: [] }), params, s);
      }
      return fb;
    };
    const a = drive(s1);
    const b = drive(s2);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
  });

  it('processes a trigger seq only once', () => {
    const m = model(1);
    const state = confettiBurst.createState!(m);
    const params = { count: 8, life: 5000, gravity: 0 };
    const triggers = [trig(5, 'd0', 36, 1, 0)];
    render(confettiBurst, m, ctx(m, { dt: 16, triggers }), params, state);
    const after = state.particles.length;
    // Re-presenting the same seq must not spawn again.
    render(confettiBurst, m, ctx(m, { dt: 16, triggers }), params, state);
    expect(state.particles.length).toBeLessThanOrEqual(after);
  });
});

describe('helix', () => {
  it('lights >0 pixels at a non-trivial time', () => {
    const m = model(2, 4);
    const fb = render(helix, m, ctx(m, { timeMs: 350 }), { speed: 1.5 });
    expect(litCount(fb)).toBeGreaterThan(0);
    expect(finite01Failures(fb, 'helix')).toEqual([]);
  });
});

describe('orbit-rings', () => {
  it('lights pixels as the plane sweeps and stays finite', () => {
    const m = model(2, 4);
    // Sample several times so the plane passes through the kit at some point.
    let totalLit = 0;
    for (let f = 0; f < 8; f++) {
      const fb = render(orbitRings, m, ctx(m, { timeMs: f * 200 }), { width: 200, amp: 1, speed: 1.5 });
      expect(finite01Failures(fb, 'orbit-rings')).toEqual([]);
      totalLit += litCount(fb);
    }
    expect(totalLit).toBeGreaterThan(0);
  });
});
