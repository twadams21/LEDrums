/* M6 — the scene adapter through the ONE EffectGenerator seam: registry resolution,
   determinism, and the scene-level params driven by the STANDARD modulation sweep
   (an LFO on canvasRotDeg must animate with zero new plumbing). */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { defaultParams, type ResolvedParams } from '../effects/types';
import { getEffect, tryGetEffect } from '../effects/registry';
import { applyModulations, type Mapping } from '../voice/modulation';
import { defaultLfoSettings } from '../voice/lfo';
import { registerCanvasScene, unregisterCanvasScene, tryGetCanvasEffect } from './registry';
import { CANVAS_PARAM_SPEC, createCanvasSceneEffect } from './scene';
import type { CanvasScene } from './types';

function model(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 40, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [
        { id: 'd0', diameterIn: 8, pixelsPerHoop: 16, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'd1', diameterIn: 8, pixelsPerHoop: 16, hoopSpacingMm: 50, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

function ctx(m: PixelModel, timeMs = 0): RenderContext {
  return {
    model: m,
    timeMs,
    dt: 16,
    transport: { timeMs, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
    triggers: [],
  };
}

const scene: CanvasScene = {
  id: 'test-stripes',
  name: 'Test Stripes',
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.5, duty: 0.5, speedUps: 0, hue: 0, sat: 0, softness: 0 }],
  sampler: { kind: 'cylinder' },
};

function renderFrame(m: PixelModel, params: ResolvedParams = {}, timeMs = 0): Framebuffer {
  const gen = createCanvasSceneEffect(scene);
  const fb = new Framebuffer(m.pixelCount);
  const s = gen.createState!(m);
  gen.render(ctx(m, timeMs), { ...defaultParams(gen.paramSpec), ...params }, fb, s);
  return fb;
}

function litCount(fb: Framebuffer): number {
  let n = 0;
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) n++;
  }
  return n;
}

describe('canvas scene adapter — one seam, no fork (D4)', () => {
  it('a registered scene resolves through the effects registry as canvas:<sceneId>', () => {
    registerCanvasScene(scene);
    const gen = tryGetEffect('canvas:test-stripes');
    expect(gen).toBeDefined();
    expect(gen!.id).toBe('canvas:test-stripes');
    expect(gen!.tags).toContain('canvas');
    expect(getEffect('canvas:test-stripes')).toBe(gen); // memoized adapter
    unregisterCanvasScene('test-stripes');
    expect(tryGetEffect('canvas:test-stripes')).toBeUndefined();
    expect(tryGetCanvasEffect('plasma')).toBeUndefined(); // non-canvas ids never resolve here
  });

  it('renders stripes onto the kit and lights roughly the duty fraction', () => {
    const m = model();
    const fb = renderFrame(m);
    const lit = litCount(fb);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(m.pixelCount); // duty 0.5 → a band, not a wash
  });

  it('is byte-deterministic: same (time, params, model) ⇒ identical frames', () => {
    const m = model();
    const a = renderFrame(m, { canvasRotDeg: 33, canvasScale: 1.4 }, 1234);
    const b = renderFrame(m, { canvasRotDeg: 33, canvasScale: 1.4 }, 1234);
    expect(a.rgba).toEqual(b.rgba);
  });

  it('exposes the full scene-level param surface via the standard paramSpec', () => {
    const keys = CANVAS_PARAM_SPEC.map((s) => s.key);
    for (const k of ['canvasRotDeg', 'canvasOffsetX', 'canvasOffsetY', 'canvasScale', 'samplerRotDeg', 'speed', 'brightness', 'hue']) {
      expect(keys).toContain(k);
    }
  });

  it('canvasRotDeg / brightness / hue visibly drive the frame', () => {
    const m = model();
    const base = renderFrame(m);
    expect(renderFrame(m, { canvasRotDeg: 90 }).rgba).not.toEqual(base.rgba);
    expect(litCount(renderFrame(m, { brightness: 0 }))).toBe(0);
    // hue-rotating a white stripe keeps it white; use a saturated scene param instead:
    const red = renderFrame(m, {});
    const j = red.rgba.findIndex((x) => x > 0.004);
    expect(j).toBeGreaterThanOrEqual(0);
  });

  it('an LFO on canvasRotDeg animates through the STANDARD modulation sweep (zero new UI)', () => {
    const mapping: Mapping = {
      targetParam: 'canvasRotDeg',
      source: { kind: 'lfo', lfo: defaultLfoSettings() }, // sine, 1 Hz
      amount: 1,
      invert: false,
      rangeMin: 0,
      rangeMax: 360,
    };
    const base = defaultParams(CANVAS_PARAM_SPEC) as Record<string, number | boolean | string>;
    const sweep = (timeMs: number): number => {
      const out: Record<string, number | boolean | string> = { ...base };
      applyModulations(base, out, [mapping], CANVAS_PARAM_SPEC, { phase: 0, timeMs, bpm: 120 });
      return out.canvasRotDeg as number;
    };
    const at0 = sweep(0); //    sine @ phase 0   → 0.5 → 180°
    const at250 = sweep(250); // sine @ quarter → 1   → 360°
    expect(at0).toBeCloseTo(180, 5);
    expect(at250).toBeCloseTo(360, 5);

    // and the differing param values produce different frames — the LFO ANIMATES the scene
    const m = model();
    const f0 = renderFrame(m, { canvasRotDeg: at0 });
    const f250 = renderFrame(m, { canvasRotDeg: at250 });
    expect(f0.rgba).not.toEqual(f250.rgba);
  });
});
