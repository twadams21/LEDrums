import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { BUILTIN_CANVAS_SCENES } from '../canvas/presets';
import { canvasEffectId } from '../canvas/ids';
import { tryGetCanvasEffect } from '../canvas/registry';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import { orbitComet } from './impl/orbit-comet';
import { scanPlane } from './impl/scan-plane';
import { drumSonar } from './impl/drum-sonar';
import { gravityDrops } from './impl/gravity-drops';

function model(drums = 2, hoopCount = 4): PixelModel {
  const drumDefs = [];
  for (let i = 0; i < drums; i++) {
    drumDefs.push({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return buildPixelModel(parseKit({ global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 }, drums: drumDefs }));
}

function transport(beat = 0, timeMs = 0): TransportState {
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

function ctx(m: PixelModel, opts: Partial<RenderContext> = {}): RenderContext {
  return { model: m, timeMs: opts.timeMs ?? 0, dt: opts.dt ?? 16, transport: opts.transport ?? transport(0, opts.timeMs ?? 0), triggers: opts.triggers ?? [] };
}

function trig(seq: number, drumId: string, note: number, velocity: number, ageMs: number): Trigger {
  return { seq, drumId, note, velocity, ageMs, timeMs: 0 };
}

function render<S>(effect: EffectGenerator<S>, m: PixelModel, c: RenderContext, params?: ResolvedParams, state?: S): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const p = { ...defaultParams(effect.paramSpec), ...params };
  const s = state ?? (effect.createState ? effect.createState(m, 123) : (undefined as S));
  effect.render(c, p, fb, s);
  return fb;
}

function litIds(fb: Framebuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < fb.pixelCount; i++) {
    const j = i * 4;
    if (fb.rgba[j]! > 0.004 || fb.rgba[j + 1]! > 0.004 || fb.rgba[j + 2]! > 0.004) out.push(i);
  }
  return out;
}

function assertFinite01(fb: Framebuffer, id: string): void {
  for (let i = 0; i < fb.rgba.length; i++) {
    const v = fb.rgba[i]!;
    expect(Number.isFinite(v), `${id} channel ${i}`).toBe(true);
    expect(v >= 0 && v <= 1, `${id} channel ${i} = ${v}`).toBe(true);
  }
}

describe('U6 built-in canvas scenes', () => {
  it('registers at least ten scene-backed canvas generators with descriptions and tags', () => {
    expect(BUILTIN_CANVAS_SCENES.length).toBeGreaterThanOrEqual(10);
    for (const scene of BUILTIN_CANVAS_SCENES) {
      expect(scene.description?.length ?? 0).toBeGreaterThan(20);
      expect(scene.tags ?? []).toContain('canvas');
      expect(tryGetCanvasEffect(canvasEffectId(scene.id))?.id).toBe(canvasEffectId(scene.id));
    }
  });

  it('ships at least two scenes for every U6 lens family', () => {
    const counts = new Map<string, number>();
    for (const scene of BUILTIN_CANVAS_SCENES) {
      for (const lens of scene.lenses ?? []) counts.set(lens.kind, (counts.get(lens.kind) ?? 0) + 1);
    }
    for (const kind of ['polar', 'unpolar', 'log-polar', 'kaleido', 'mobius', 'tile', 'swirl', 'hyper4d']) {
      expect(counts.get(kind) ?? 0, kind).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('U6 gap-fill natives', () => {
  const effects = [orbitComet, scanPlane, drumSonar, gravityDrops] as EffectGenerator<unknown>[];

  it('render finite [0,1] frames and light pixels from hits', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 0.8, 40), trig(2, 'd1', 38, 1, 120)];
    for (const e of effects) {
      const state = e.createState!(m, 99);
      const fb = render(e, m, ctx(m, { dt: 0, timeMs: 180, transport: transport(1.2, 180), triggers }), {}, state);
      assertFinite01(fb, e.id);
      expect(litIds(fb).length, e.id).toBeGreaterThan(0);
    }
  });

  it('are deterministic across identical seeded replays', () => {
    const m = model(2);
    for (const e of effects) {
      const run = (): Framebuffer => {
        const state = e.createState!(m, 42);
        render(e, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 0.7, 80)] }), {}, state);
        return render(e, m, ctx(m, { dt: 240, timeMs: 240, transport: transport(0.5, 240) }), {}, state);
      };
      expect(run().rgba, e.id).toEqual(run().rgba);
    }
  });

  it('tracks one emission per new hit for all four effects', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 1, 0)];
    const cases = [orbitComet.createState!(m), scanPlane.createState!(m), drumSonar.createState!(m), gravityDrops.createState!(m)];
    render(orbitComet, m, ctx(m, { dt: 0, triggers }), {}, cases[0]);
    render(scanPlane, m, ctx(m, { dt: 0, triggers }), {}, cases[1]);
    render(drumSonar, m, ctx(m, { dt: 0, triggers }), {}, cases[2]);
    render(gravityDrops, m, ctx(m, { dt: 0, triggers }), {}, cases[3]);
    expect(cases[0].em.emissions.length).toBe(2);
    expect(cases[1].em.emissions.length).toBe(2);
    expect(cases[2].em.emissions.length).toBe(2);
    expect(cases[3].em.emissions.length).toBe(2);
  });
});
