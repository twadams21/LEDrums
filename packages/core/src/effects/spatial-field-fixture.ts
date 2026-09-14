/** Pure fixture/adapters for spatial unit tests and the opt-in matched benchmark.
 * Not imported by the registry or production renderer. No devices, IO or dependencies.
 */
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, Trigger } from '../engine/render-context';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { hsvToRgb } from '../color/color';
import { clamp01 } from '../math';
import { defaultParams, pnum, type EffectGenerator, type ResolvedParams } from './types';
import { spatialWaveShell } from './spatial-distortions';
import { createSpatialSampling, sampleSpatialField, updateSpatialSampling } from './spatial-sampling';

export function spatialFixtureKit(counts = [12, 9, 7, 10]) {
  return parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 60 },
    drums: counts.map((pixelsPerHoop, i) => ({
      id: `d${i}`, diameterIn: 10 + i * 2, pixelsPerHoop, hoopSpacingMm: 60,
      origin: { x: i * 500, y: (i % 2) * 270, z: i * 140 },
      rotation: { x: i === 0 ? 90 : i * 8, y: i * 13, z: i * 21 },
    })),
  });
}

/** Exactly 2,300 pixels, four drums × four hoops, with world rotations. */
export function spatialBenchmarkModel(): PixelModel {
  return buildPixelModel(spatialFixtureKit([196, 108, 108, 163]));
}

export function spatialFixtureContext(model: PixelModel): RenderContext {
  return {
    model, timeMs: 0, dt: 0, triggers: [],
    transport: { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
  };
}

export function spatialHit(seq = 1, drumId = 'd0', ageMs = 80, velocity = 0.8): Trigger {
  return { seq, drumId, ageMs, velocity, note: 38, timeMs: 0 };
}

export function createSpatialFixture<S>(effect: EffectGenerator<S>, model: PixelModel, overrides: ResolvedParams = {}) {
  const ctx = spatialFixtureContext(model);
  const fb = new Framebuffer(model.pixelCount);
  const state = effect.createState!(model, 123);
  const params = { ...defaultParams(effect.paramSpec), ...overrides };
  return {
    ctx, fb, state, params,
    render(timeMs: number, dt: number, triggers: readonly Trigger[] = []): Framebuffer {
      ctx.timeMs = timeMs;
      ctx.dt = dt;
      ctx.triggers = triggers;
      ctx.transport.timeMs = timeMs;
      ctx.transport.beat = timeMs / 500;
      ctx.transport.bar = Math.floor(ctx.transport.beat / 4);
      ctx.transport.beatInBar = ctx.transport.beat % 4;
      fb.clear();
      effect.render(ctx, params, fb, state);
      return fb;
    },
  };
}

/** Uncached comparison adapter for the production point seam. It directly normalises world
 * points and samples supplied hit ages; no emitter/geometry/wave-scratch implementation is
 * shared with the production traversal. Suitable for a future CPU-vs-shader point comparison,
 * NOT a substitute for the frozen old-default oracle in spatial-field-reference.ts.
 */
export function sampleSpatialPoints(model: PixelModel, params: ResolvedParams, timeMs: number, hits: readonly Trigger[] = []): Framebuffer {
  const sampling = createSpatialSampling();
  updateSpatialSampling(sampling, params, timeMs);
  const scratch = { x: 0, y: 0, z: 0 };
  const fb = new Framebuffer(model.pixelCount);
  const invScale = 1 / (model.bounds.size > 1 ? model.bounds.size * 0.5 : 1);
  const centre = model.bounds.center;
  for (const p of model.pixels) {
    let ripple = 0;
    for (const hit of hits) {
      const drum = model.drumById.get(hit.drumId);
      if (!drum) continue;
      const life = Math.max(1, pnum(params, 'lifeMs', 1500));
      const strength = clamp01(1 - hit.ageMs / life) * clamp01(hit.velocity) * clamp01(pnum(params, 'disturbance', 0.85));
      if (strength < 0.002) continue;
      const o = drum.effectOriginWorld;
      const dx = p.world.x - o.x, dy = p.world.y - o.y, dz = p.world.z - o.z;
      ripple += spatialWaveShell(Math.sqrt(dx * dx + dy * dy + dz * dz),
        pnum(params, 'waveSpeed', 1100) * hit.ageMs / 1000, pnum(params, 'waveWidth', 240)) * strength;
    }
    ripple = clamp01(ripple);
    const lum = sampleSpatialField((p.world.x - centre.x) * invScale, (p.world.y - centre.y) * invScale,
      (p.world.z - centre.z) * invScale, ripple, sampling, scratch);
    const band = 0.06 + 0.94 * lum * lum;
    const v = clamp01(clamp01(pnum(params, 'brightness', 1)) * clamp01(band + ripple * 0.7));
    if (v < 0.004) continue;
    const rgb = hsvToRgb(pnum(params, 'hue', 205) + (lum - 0.5) * pnum(params, 'hueSpread', 70) + ripple * 25,
      pnum(params, 'saturation', 0.85), v);
    fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
  }
  return fb;
}
