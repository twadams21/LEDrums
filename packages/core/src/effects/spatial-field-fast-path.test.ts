import { describe, expect, it } from 'vitest';
import { buildPixelModel } from '../geometry/pixel-model';
import { spatialField } from './impl/spatial-field';
import { spatialFieldReference } from './spatial-field-reference';
import { createSpatialFixture, sampleSpatialPoints, spatialBenchmarkModel, spatialFixtureKit, spatialHit } from './spatial-field-fixture';

describe('Spatial Field neutral-feature execution', () => {
  it('keeps the specialized traversal exact against the general point sampler', () => {
    const model = buildPixelModel(spatialFixtureKit());
    for (const scale of [0.2, 1.4, 6, Number.MAX_VALUE]) {
      for (const twist of [-8, 0, 2.2, 8]) {
        for (const hits of [[], [spatialHit(1, 'd0', 120, 1)], [spatialHit(1, 'd2', 450, 0.3)]]) {
          const fixture = createSpatialFixture(spatialField, model, { scale, twist });
          for (const time of [0, 713, 1234]) {
            expect(fixture.render(time, 0, hits).rgba)
              .toEqual(sampleSpatialPoints(model, fixture.params, time, hits).rgba);
          }
        }
      }
    }
  });

  it('keeps the reduced brightness clamp exact at full authored wave strength', () => {
    const model = buildPixelModel(spatialFixtureKit());
    for (const brightness of [-1, 0, 0.5, 1, 2]) {
      const params = { disturbance: 1, waveWidth: 1000, brightness };
      const old = createSpatialFixture(spatialFieldReference, model, params);
      const next = createSpatialFixture(spatialField, model, params);
      old.ctx.authoredDecay = next.ctx.authoredDecay = true;
      const hits = [spatialHit(1, 'd0', 120, 1)];
      expect(next.render(713, 0, hits).rgba).toEqual(old.render(713, 0, hits).rgba);
      expect(next.state.waves[4]).toBe(1);
      expect(next.render(913, 0).rgba).toEqual(old.render(913, 0).rgba);
    }
  });

  it('fills cold caches even when dark, and invalidates on source/model changes across traversals', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const old = createSpatialFixture(spatialFieldReference, model);
    const next = createSpatialFixture(spatialField, model);
    for (const [time, dt, brightness, hits] of [
      [0, 0, 0, [spatialHit(1, 'd0', 120)]],
      [713, 0, 1, []],
      [900, 1600, 1, []],
      [1100, 0, 1, [spatialHit(2, 'd2', 120)]],
      [1250, 0, 1, [spatialHit(3, 'd3', 120)]],
      [1400, 1600, 1, []],
    ] as const) {
      old.params.brightness = next.params.brightness = brightness;
      expect(next.render(time, dt, hits).rgba).toEqual(old.render(time, dt, hits).rgba);
    }
    const normalized = next.state.geometry.normalized;
    const kit = spatialFixtureKit();
    kit.drums.reverse();
    kit.drums[1]!.rotation.y += 45;
    const changed = buildPixelModel(kit);
    old.ctx.model = next.ctx.model = changed;
    const hits = [spatialHit(4, 'd0', 120)];
    expect(next.render(1600, 0, hits).rgba).toEqual(old.render(1600, 0, hits).rgba);
    expect(next.state.geometry.normalized).not.toBe(normalized);
    expect(next.state.geometry.distances.length).toBe(changed.pixelCount);
    expect(next.render(1700, 16).rgba).toEqual(old.render(1700, 16).rgba);
  });

  it.each([false, true])('switches rich → neutral on the same params/state with live waves=%s', (waves) => {
    const model = spatialBenchmarkModel();
    const fixture = createSpatialFixture(spatialField, model);
    const hits = waves ? [spatialHit(1, 'd0', 120, 1)] : [];
    // Hold a genuinely active wave, including across parameter edits, rather than letting
    // warmup expire it. The independent point adapter uses these same supplied hit ages.
    for (const warpMode of ['swirl', 'ripple']) {
      for (const detailMode of ['harmonics', 'ridges']) {
        Object.assign(fixture.params, { warpMode, detailMode, warp: 0.8, detail: 0.6, advection: 0.7 });
        expect(fixture.render(713, 0, hits).rgba)
          .toEqual(sampleSpatialPoints(model, fixture.params, 713, hits).rgba);
        for (const key of ['warp', 'detail', 'advection']) fixture.params[key] = 0;
        expect(fixture.render(713, 0, hits).rgba)
          .toEqual(createSpatialFixture(spatialFieldReference, model).render(713, 0, hits).rgba);
        for (const key of ['warp', 'detail', 'advection']) delete fixture.params[key];
        expect(fixture.render(913, 0, hits).rgba)
          .toEqual(createSpatialFixture(spatialFieldReference, model).render(913, 0, hits).rgba);
      }
    }
  });
});
