/* D5 — lens goldens: per-lens behaviour, ordered chain composition, and the payoff
   golden the plan promises: stripes + polar == rings. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { defaultParams } from '../effects/types';
import { applyLens, applyLensChain, hyper4dUv, type UvPair } from './lenses';
import { buildSamplerTable } from './sampler';
import { createCanvasSceneEffect } from './scene';
import type { CanvasScene, Lens } from './types';

const uv = (u: number, v: number): UvPair => [u, v];

describe('lenses — pure (u,v) warps', () => {
  it('polar: u becomes the angle, v the radius; unpolar inverts it', () => {
    const p = uv(0.9, 0.5); // 0.4 right of centre → angle 0, radius 0.8
    applyLens({ kind: 'polar' }, p, 0);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(0.8, 5);
    applyLens({ kind: 'unpolar' }, p, 0);
    expect(p[0]).toBeCloseTo(0.9, 5);
    expect(p[1]).toBeCloseTo(0.5, 5);
  });

  it('tile: wraps the plane into cols×rows repeats', () => {
    const p = uv(0.75, 0.6);
    applyLens({ kind: 'tile', cols: 2, rows: 5 }, p, 0);
    expect(p[0]).toBeCloseTo(0.5, 5); // 0.75·2 = 1.5 → 0.5
    expect(p[1]).toBeCloseTo(0, 5); //   0.6·5 = 3.0 → 0.0
  });

  it('kaleido: points mirrored across a sector boundary land identically', () => {
    const k: Lens = { kind: 'kaleido', sectors: 4, spinDeg: 0 };
    const a = uv(0.5 + 0.3 * Math.cos(0.3), 0.5 + 0.3 * Math.sin(0.3));
    const b = uv(0.5 + 0.3 * Math.cos(-0.3), 0.5 + 0.3 * Math.sin(-0.3)); // mirror of a
    applyLens(k, a, 0);
    applyLens(k, b, 0);
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(a[1]).toBeCloseTo(b[1], 5);
  });

  it('swirl: identity outside its radius, rotation inside', () => {
    const s: Lens = { kind: 'swirl', amount: 1, radius: 0.2 };
    const outside = uv(0.9, 0.5);
    applyLens(s, outside, 0);
    expect(outside[0]).toBeCloseTo(0.9, 6);
    expect(outside[1]).toBeCloseTo(0.5, 6);
    const inside = uv(0.55, 0.5);
    applyLens(s, inside, 0);
    expect(Math.hypot(inside[0] - 0.5, inside[1] - 0.5)).toBeCloseTo(0.05, 6); // radius kept
    expect(inside[1]).not.toBeCloseTo(0.5, 3); // but rotated off-axis
  });

  it('mobius: a=b=0 is identity; non-zero coefficients warp conformally', () => {
    const p = uv(0.7, 0.6);
    applyLens({ kind: 'mobius', a: 0, b: 0 }, p, 0);
    expect(p[0]).toBeCloseTo(0.7, 6);
    expect(p[1]).toBeCloseTo(0.6, 6);
    applyLens({ kind: 'mobius', a: 0.8, b: 0.4 }, p, 0);
    expect(p[0]).not.toBeCloseTo(0.7, 3);
  });

  it('log-polar: radius maps to a log axis (doubling r shifts v by a constant)', () => {
    const a = uv(0.6, 0.5); // r 0.1
    const b = uv(0.7, 0.5); // r 0.2
    const c = uv(0.9, 0.5); // r 0.4
    applyLens({ kind: 'log-polar', zoom: 1 }, a, 0);
    applyLens({ kind: 'log-polar', zoom: 1 }, b, 0);
    applyLens({ kind: 'log-polar', zoom: 1 }, c, 0);
    expect(b[1] - a[1]).toBeCloseTo(c[1] - b[1], 6);
  });

  it('chain composition is ORDERED: [tile → polar] ≠ [polar → tile]', () => {
    const p1 = uv(0.7, 0.65);
    const p2 = uv(0.7, 0.65);
    applyLensChain([{ kind: 'tile', cols: 3, rows: 3 }, { kind: 'polar' }], p1, 0);
    applyLensChain([{ kind: 'polar' }, { kind: 'tile', cols: 3, rows: 3 }], p2, 0);
    expect(Math.hypot(p1[0] - p2[0], p1[1] - p2[1])).toBeGreaterThan(1e-3);
  });

  it('hyper4d: time moves the projection (patterns crawl); wSpeed 0 with zero rotations is stable', () => {
    const world = { x: 100, y: 50, z: 25 };
    const center = { x: 0, y: 0, z: 0 };
    const a: UvPair = [0, 0];
    const b: UvPair = [0, 0];
    const lens: Lens = { kind: 'hyper4d', rotXW: 30, rotYW: 20, rotZW: 10, wSpeed: 1 };
    hyper4dUv(lens, world, center, 1 / 500, 0, a);
    hyper4dUv(lens, world, center, 1 / 500, 1, b);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1e-4);
    const still: Lens = { kind: 'hyper4d', rotXW: 0, rotYW: 0, rotZW: 0, wSpeed: 0 };
    hyper4dUv(still, world, center, 1 / 500, 0, a);
    hyper4dUv(still, world, center, 1 / 500, 5, b);
    expect(a).toEqual(b);
  });
});

// ---- the D5 payoff golden -----------------------------------------------------------

function kit(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 3, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 24, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 10, pixelsPerHoop: 20, hoopSpacingMm: 50, origin: { x: 500, y: 200, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

describe('golden: stripes + polar == rings', () => {
  it('lit/unlit is a function of canvas radius ONLY (concentric rings), and both bands exist', () => {
    const m = kit();
    // stripes vary along v; polar maps v ← radius → the stripe bands become rings.
    const scene: CanvasScene = {
      id: 'rings',
      name: 'Rings',
      elements: [{ kind: 'stripes', angleDeg: 90, widthU: 0.4, duty: 0.5, speedUps: 0, hue: 0, sat: 0, softness: 0 }],
      sampler: { kind: 'footprint' },
      lenses: [{ kind: 'polar' }],
    };
    const gen = createCanvasSceneEffect(scene);
    const fb = new Framebuffer(m.pixelCount);
    const ctx: RenderContext = {
      model: m,
      timeMs: 0,
      dt: 16,
      transport: { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
      triggers: [],
    };
    gen.render(ctx, defaultParams(gen.paramSpec), fb, gen.createState!(m));

    // reconstruct each pixel's canvas radius from the SAME footprint placement
    const table = buildSamplerTable(m, { kind: 'footprint' });
    const litByRadius = new Map<string, boolean>();
    let lit = 0;
    let dark = 0;
    for (let i = 0; i < m.pixelCount; i++) {
      const r = Math.hypot(table.u[i]! - 0.5, table.v[i]! - 0.5);
      const isLit = fb.rgba[i * 4]! > 0.004;
      isLit ? lit++ : dark++;
      const key = r.toFixed(4); // pixels at (numerically) equal radius must agree
      const prev = litByRadius.get(key);
      if (prev !== undefined) expect(prev, `radius ${key}`).toBe(isLit);
      litByRadius.set(key, isLit);
    }
    expect(lit).toBeGreaterThan(0); //  rings present…
    expect(dark).toBeGreaterThan(0); // …with gaps between them
    // and the pattern is NOT a function of angle: two pixels at the same radius but
    // far-apart angles were already asserted equal via the radius bucket above.
  });
});
