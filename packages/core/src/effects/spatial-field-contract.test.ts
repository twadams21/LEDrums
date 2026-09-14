import { describe, expect, it, vi } from 'vitest';
import { buildPixelModel } from '../geometry/pixel-model';
import type { Trigger } from '../engine/render-context';
import { cloneRenderState } from '../voice/render-checkpoint';
import { spatialField } from './impl/spatial-field';
import { spatialFieldReference } from './spatial-field-reference';
import { MAX_EMISSIONS } from './emitter';
import type { ResolvedParams } from './types';
import { createSpatialFixture, sampleSpatialPoints, spatialBenchmarkModel, spatialFixtureKit, spatialHit } from './spatial-field-fixture';

function difference(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);
}
function finite(frame: Float32Array): boolean {
  return frame.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}
const rich: ResolvedParams = { warp: 0.8, warpScale: 2.7, advection: 0.65, detail: 0.7, detailScale: 3.5 };

// This oracle deliberately predates all new helpers and all caches. Byte equality of the
// Float32 channels is stronger than equal aggregate energy / a visually similar thumbnail.
describe('frozen Spatial Field parity', () => {
  for (const authoredDecay of [false, true]) {
    it(`keeps old defaults and authored legacy params exactly (authoredDecay=${authoredDecay})`, () => {
      const model = buildPixelModel(spatialFixtureKit());
      const old = createSpatialFixture(spatialFieldReference, model);
      const next = createSpatialFixture(spatialField, model);
      old.ctx.authoredDecay = next.ctx.authoredDecay = authoredDecay;
      const variants: ResolvedParams[] = [
        {}, { scale: 6, twist: -8, waveSpeed: 4500, waveWidth: 20, disturbance: 1 },
        { scale: 0.2, twist: 8, waveSpeed: 100, waveWidth: 1000, lifeMs: 6000, brightness: 0.4 },
        { hue: 360, saturation: 0, hueSpread: 0, speed: 0 },
        { disturbance: 0, brightness: 0 },
      ];
      let seq = 1;
      for (const params of variants) {
        // Reuse each params object, just as the production bridge/modulation path does.
        Object.assign(old.params, params);
        Object.assign(next.params, params);
        for (const dt of [0, 16, 120, 500, 1600, 7000]) {
          const time = seq * 333 + dt;
          const hits = [spatialHit(seq++, 'd0'), spatialHit(seq++, 'd2', 200, 0.3), spatialHit(seq++, 'missing')];
          expect(next.render(time, dt, hits).rgba).toEqual(old.render(time, dt, hits).rgba);
        }
      }
    });
  }

  it('keeps zero-amount modes/scales inert, including absent params in older shows', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const old = createSpatialFixture(spatialFieldReference, model);
    const next = createSpatialFixture(spatialField, model, { warpMode: 'ripple', warpScale: 6, detailMode: 'ridges', detailScale: 8 });
    const hits = [spatialHit()];
    expect(next.render(1234, 0, hits).rgba).toEqual(old.render(1234, 0, hits).rgba);
    for (const key of ['warp', 'advection', 'detail']) delete next.params[key];
    expect(next.render(1500, 16).rgba).toEqual(old.render(1500, 16).rgba);
  });

  it('matches the 2,300-pixel benchmark fixture before any wall-clock measurement', () => {
    const model = spatialBenchmarkModel();
    expect(model.pixelCount).toBe(2300);
    const old = createSpatialFixture(spatialFieldReference, model);
    const next = createSpatialFixture(spatialField, model);
    for (const time of [0, 16, 450, 900]) {
      const hits = [spatialHit(1, 'd0', 0, 1)];
      expect(next.render(time, 16, hits).rgba).toEqual(old.render(time, 16, hits).rgba);
    }
  });
});

describe('authored spatial complexity', () => {
  const cases: ResolvedParams[] = [
    { warp: 0.9, warpMode: 'swirl' }, { warp: 0.9, warpMode: 'ripple' }, { advection: 0.8 },
    { detail: 0.9, detailMode: 'harmonics' }, { detail: 0.9, detailMode: 'ridges' }, rich,
  ];
  it.each(cases)('nonzero %j visibly changes finite output', (params) => {
    const model = buildPixelModel(spatialFixtureKit());
    const base = createSpatialFixture(spatialField, model).render(1700, 0).rgba;
    const actual = createSpatialFixture(spatialField, model, params).render(1700, 0).rgba;
    expect(finite(actual)).toBe(true);
    expect(difference(base, actual) / model.pixelCount).toBeGreaterThan(0.04);
  });

  it.each(['swirl', 'ripple'])('%s uses the pure point adapter for all XYZ and hit contributions', (warpMode) => {
    const model = buildPixelModel(spatialFixtureKit());
    const fixture = createSpatialFixture(spatialField, model, { ...rich, warpMode });
    const hits = [spatialHit(1), spatialHit(2, 'd2', 210), spatialHit(3, 'missing')];
    expect(fixture.render(713, 0, hits).rgba).toEqual(sampleSpatialPoints(model, fixture.params, 713, hits).rgba);
  });

  it('refreshes every parameter by value on the SAME carrier, without geometry rebuilds', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const next = createSpatialFixture(spatialField, model, rich);
    next.render(1200, 0, [spatialHit()]);
    const normalized = next.state.geometry.normalized;
    const distances = next.state.geometry.distances;
    const changes: ResolvedParams[] = [
      { scale: 3.1 }, { twist: -5 }, { speed: 0.9 }, { warp: 0.2 }, { warpMode: 'ripple' },
      { warpScale: 5.1 }, { advection: 0.1 }, { detail: 0.3 }, { detailMode: 'ridges' },
      { detailScale: 7.2 }, { waveWidth: 1000 }, { waveSpeed: 900 }, { lifeMs: 300 },
      { disturbance: 0.2 }, { hue: 80 }, { saturation: 0.3 }, { brightness: 0.7 }, { hueSpread: 250 },
    ];
    for (const change of changes) {
      const before = next.render(1200, 0).rgba.slice();
      Object.assign(next.params, change);
      const actual = next.render(1200, 0).rgba;
      const fresh = createSpatialFixture(spatialField, model, next.params);
      expect(actual, JSON.stringify(change)).toEqual(fresh.render(1200, 0, [spatialHit()]).rgba);
      expect(difference(actual, before), JSON.stringify(change)).toBeGreaterThan(0.001);
      expect(next.state.geometry.normalized).toBe(normalized);
      expect(next.state.geometry.distances).toBe(distances);
    }
  });

  it('rich speed 0 freezes time-dependent domain/detail movement, not hit-relative aging', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const next = createSpatialFixture(spatialField, model, { ...rich, speed: 0 });
    const a = next.render(0, 0).rgba.slice();
    expect(next.render(1e9, 0).rgba).toEqual(a);
    const hit = next.render(1e9, 0, [spatialHit()]).rgba.slice();
    expect(difference(hit, a)).toBeGreaterThan(0.1);
    expect(difference(next.render(1e9, 400).rgba, hit)).toBeGreaterThan(0.1);
  });

  it('deterministically replays uneven dt, seeks, parameter edits and a checkpoint fork', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const run = () => {
      const fixture = createSpatialFixture(spatialField, model, rich);
      const frames: Float32Array[] = [];
      for (const [i, dt] of [0, 16, 400, 0, 90, 3000, 8].entries()) {
        fixture.params.warpMode = i % 2 ? 'ripple' : 'swirl';
        frames.push(fixture.render(i % 2 ? 500 : 900, dt, [spatialHit(i + 1, `d${i % 4}`)]).rgba.slice());
      }
      return { fixture, frames };
    };
    const a = run();
    expect(a.frames).toEqual(run().frames);
    const fork = cloneRenderState(a.fixture.state, model);
    expect(fork.geometry.model).toBe(model);
    expect(fork.geometry.normalized).not.toBe(a.fixture.state.geometry.normalized);
    const fb = a.fixture.render(1234, 80);
    const expected = fb.rgba.slice();
    fb.clear();
    spatialField.render(a.fixture.ctx, a.fixture.params, fb, fork);
    expect(fb.rgba).toEqual(expected);
  });
});

describe('geometry and bounded engine-owned cache lifetime', () => {
  it('rebuilds on resize, shrink, same-count transforms and reorder, never on frame time', () => {
    const initial = buildPixelModel(spatialFixtureKit());
    const fixture = createSpatialFixture(spatialField, initial, rich);
    fixture.render(900, 0, [spatialHit()]);
    let prior = fixture.state.geometry.normalized;
    const rotated = spatialFixtureKit();
    rotated.drums[1]!.rotation.x += 70;
    rotated.drums[1]!.origin.z += 125;
    const reordered = spatialFixtureKit();
    reordered.drums.reverse();
    for (const kit of [spatialFixtureKit([20, 30, 15, 25]), spatialFixtureKit([1, 2]), rotated, reordered]) {
      const model = buildPixelModel(kit);
      const fresh = createSpatialFixture(spatialField, model, rich);
      fixture.ctx.model = model;
      // Direct adapter reuse (the production compositor instead resets all geometry state).
      const fb = fresh.fb;
      const ctx = { ...fixture.ctx, model, timeMs: 900, dt: 0, triggers: [] };
      spatialField.render(ctx, fixture.params, fb, fixture.state);
      const expected = createSpatialFixture(spatialField, model, rich).render(900, 0, [spatialHit()]);
      expect(fb.rgba).toEqual(expected.rgba);
      expect(fixture.state.geometry.model).toBe(model);
      expect(fixture.state.geometry.normalized).not.toBe(prior);
      expect(fixture.state.geometry.normalized.length).toBe(model.pixelCount * 3);
      expect(fixture.state.geometry.distances.length).toBe(model.pixelCount);
      prior = fixture.state.geometry.normalized;
      fb.clear();
      spatialField.render({ ...ctx, timeMs: 1000 }, fixture.params, fb, fixture.state);
      expect(fixture.state.geometry.normalized).toBe(prior);
    }
  });

  it('uses rotated/world positions and not local coordinates, UV, order or scene-camera state', () => {
    const original = buildPixelModel(spatialFixtureKit());
    const rotatedKit = spatialFixtureKit();
    rotatedKit.drums[1]!.rotation.x += 65;
    rotatedKit.drums[1]!.origin.y += 100;
    const changed = buildPixelModel(rotatedKit);
    // Pin bounds to isolate moving ONE drum within the same world field; recomputing bounds
    // normally (and intentionally) renormalises the entire kit, including unmoved drums.
    changed.bounds = original.bounds;
    const base = createSpatialFixture(spatialField, original, rich).render(750, 0).rgba;
    const actual = createSpatialFixture(spatialField, changed, rich).render(750, 0).rgba;
    for (const drum of changed.drums) {
      const start = drum.pixelStart * 4, end = start + drum.pixelCount * 4;
      if (drum.drumId === 'd1') expect(difference(base.slice(start, end), actual.slice(start, end))).toBeGreaterThan(1);
      else expect(actual.slice(start, end)).toEqual(base.slice(start, end));
    }
    const poisoned = { ...changed, pixels: changed.pixels.map((p) => ({
      ...p,
      get local(): never { throw new Error('local coordinate dependency'); },
      get uv(): never { throw new Error('UV dependency'); },
    })).reverse() };
    const fixture = createSpatialFixture(spatialField, poisoned, rich);
    Object.defineProperty(fixture.ctx, 'camera', { get() { throw new Error('scene camera dependency'); } });
    Object.defineProperty(fixture.ctx, 'transport', { get() { throw new Error('field must read explicit time only'); } });
    fixture.ctx.timeMs = 750;
    spatialField.render(fixture.ctx, fixture.params, fixture.fb, fixture.state);
    expect(fixture.fb.rgba).toEqual(actual);
  });

  it('preserves kit-relative translation invariance including hit origins', () => {
    const kit = spatialFixtureKit();
    const original = buildPixelModel(kit);
    for (const drum of kit.drums) {
      drum.origin.x += 2000; drum.origin.y -= 1000; drum.origin.z += 500;
    }
    const moved = buildPixelModel(kit);
    const hits = [spatialHit()];
    const a = createSpatialFixture(spatialField, original, rich).render(713, 0, hits).rgba;
    const b = createSpatialFixture(spatialField, moved, rich).render(713, 0, hits).rgba;
    // World subtraction after translation can round the last double bits differently.
    expect(difference(a, b)).toBeLessThan(1e-5);
  });

  it('proves reused scratch and removes steady-state own-source sqrt work (not a timing claim)', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const old = createSpatialFixture(spatialFieldReference, model);
    const next = createSpatialFixture(spatialField, model);
    const hits = [spatialHit()];
    next.render(500, 0, hits);
    old.render(500, 0, hits);
    const { geometry, waves, point, sampling } = next.state;
    const normalized = geometry.normalized, distances = geometry.distances;
    const sqrt = vi.spyOn(Math, 'sqrt');
    try {
      old.render(516, 16);
      expect(sqrt).toHaveBeenCalledTimes(model.pixelCount);
      sqrt.mockClear();
      next.render(516, 16);
      expect(sqrt).not.toHaveBeenCalled();
      for (let i = 0; i < 5; i++) next.render(532 + i * 16, 16);
      expect(next.state).toMatchObject({ geometry, waves, point, sampling });
      expect(next.state.waves).toBe(waves);
      expect(next.state.point).toBe(point);
      expect(next.state.sampling).toBe(sampling);
      expect(geometry.normalized).toBe(normalized);
      expect(geometry.distances).toBe(distances);
      expect(normalized.byteLength + distances.byteLength + waves.byteLength)
        .toBe(model.pixelCount * 4 * 8 + MAX_EMISSIONS * 6 * 8);
      expect(sqrt).not.toHaveBeenCalled();
    } finally { sqrt.mockRestore(); }
  });

  it('caps state under 500 hits, reuses one distance buffer across sources, and drops expired waves', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const fixture = createSpatialFixture(spatialField, model, rich);
    const hits: Trigger[] = Array.from({ length: 500 }, (_, i) => spatialHit(i + 1, `d${i % 4}`, 0, 1));
    expect(finite(fixture.render(0, 0, hits).rgba)).toBe(true);
    expect(fixture.state.em.emissions).toHaveLength(MAX_EMISSIONS);
    expect(fixture.state.waveCount).toBe(MAX_EMISSIONS);
    expect(fixture.state.waves.length).toBe(MAX_EMISSIONS * 6);
    const distances = fixture.state.geometry.distances;
    fixture.render(2000, 2000);
    expect(fixture.state.em.emissions).toHaveLength(0);
    expect(fixture.state.waveCount).toBe(0);
    expect(fixture.render(2100, 0).rgba).toEqual(createSpatialFixture(spatialField, model, rich).render(2100, 0).rgba);
    fixture.render(2200, 0, [spatialHit(600, 'd3')]);
    expect(fixture.state.geometry.distances).toBe(distances);
    expect(fixture.state.geometry.sourceId).toBe('d3');
    expect(fixture.render(2300, 0).rgba).toEqual(createSpatialFixture(spatialField, model, rich).render(2300, 0, [spatialHit(600, 'd3')]).rgba);
  });

  it('zero-size, empty and malformed input samples stay finite', () => {
    const model = buildPixelModel(spatialFixtureKit([1]));
    model.bounds.size = 0;
    for (const p of model.pixels) p.world = { x: 0, y: 0, z: 0 };
    const fixture = createSpatialFixture(spatialField, model, { ...rich, warpMode: 'ripple' });
    expect(finite(fixture.render(0, 0, [spatialHit()]).rgba)).toBe(true);
    expect(finite(fixture.render(100, Number.NaN, [spatialHit(2, 'd0', 0, Number.NaN)]).rgba)).toBe(true);
    const empty = { ...model, pixels: [], pixelCount: 0, drums: [], drumById: new Map() };
    expect(createSpatialFixture(spatialField, empty, rich).render(0, 0).rgba.length).toBe(0);
  });
});
