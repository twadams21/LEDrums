import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { model, transport, ctx, trig, render, litIds, finite01Failures } from '../test-support/effect-harness';
import { BUILTIN_CANVAS_SCENES } from '../canvas/presets';
import { canvasEffectId } from '../canvas/ids';
import { tryGetCanvasEffect } from '../canvas/registry';
import { type EffectGenerator } from './types';
import { orbitComet } from './impl/orbit-comet';
import { scanPlane } from './impl/scan-plane';
import { drumSonar } from './impl/drum-sonar';
import { gravityDrops } from './impl/gravity-drops';

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
      const fb = render(e, m, ctx(m, { dt: 0, timeMs: 180, transport: transport(1.2, 180), triggers }), {}, state, 123);
      expect(finite01Failures(fb, e.id)).toEqual([]);
      expect(litIds(fb).length, e.id).toBeGreaterThan(0);
    }
  });

  it('are deterministic across identical seeded replays', () => {
    const m = model(2);
    for (const e of effects) {
      const run = (): Framebuffer => {
        const state = e.createState!(m, 42);
        render(e, m, ctx(m, { dt: 0, triggers: [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 0.7, 80)] }), {}, state, 123);
        return render(e, m, ctx(m, { dt: 240, timeMs: 240, transport: transport(0.5, 240) }), {}, state, 123);
      };
      expect(run().rgba, e.id).toEqual(run().rgba);
    }
  });

  it('tracks one emission per new hit for all four effects', () => {
    const m = model(2);
    const triggers = [trig(1, 'd0', 36, 1, 0), trig(2, 'd1', 38, 1, 0)];
    const orbitState = orbitComet.createState!(m);
    const scanState = scanPlane.createState!(m);
    const sonarState = drumSonar.createState!(m);
    const dropsState = gravityDrops.createState!(m);
    render(orbitComet, m, ctx(m, { dt: 0, triggers }), {}, orbitState, 123);
    render(scanPlane, m, ctx(m, { dt: 0, triggers }), {}, scanState, 123);
    render(drumSonar, m, ctx(m, { dt: 0, triggers }), {}, sonarState, 123);
    render(gravityDrops, m, ctx(m, { dt: 0, triggers }), {}, dropsState, 123);
    expect(orbitState.em.emissions.length).toBe(2);
    expect(scanState.em.emissions.length).toBe(2);
    expect(sonarState.em.emissions.length).toBe(2);
    expect(dropsState.em.emissions.length).toBe(2);
  });
});
