import { describe, expect, it, vi } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { buildPixelModel } from '../geometry/pixel-model';
import { createVoiceBusEngine } from '../voice/engine';
import { applyEffectiveParams, createDefaultCompositor } from '../voice/compositor';
import { advanceEnvelopes, reapDeadVoices } from '../voice/envelope-tick';
import { VoicePool, releaseVoice } from '../voice/voice-pool';
import { runtimeAction, runtimeBus, runtimeFrame, runtimeVoice } from '../voice/runtime-test-fixtures';
import { padKey, type EffectDef, type GraphNode, type Show, type Voice } from '../voice/types';
import type { SpatialFieldState } from './impl/spatial-field';
import { getEffect } from './registry';
import { spatialFixtureKit } from './spatial-field-fixture';

const rich = { warp: 0.6, warpMode: 'swirl', advection: 0.3, detail: 0.5, detailMode: 'ridges', lifeMs: 1500 };

function effect(): EffectDef {
  const generator = getEffect('spatial-field');
  return {
    id: 'fx', name: generator.name, generatorId: generator.id, busId: 'b', scope: 'kit',
    params: generator.paramSpec.map(({ type, ...spec }) => ({ ...spec, kind: type })),
    attackMs: 0, sustainMs: 100, releaseMs: 60,
  };
}
function node(kind: GraphNode['kind'], id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'loop', scope: 'kit', effectId: '', presetId: '', busId: 'b',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate', threshold: 0.5,
    invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...overrides,
  };
}
function show(options: { audio?: boolean; warp?: number; targetId?: string; mode?: 'loop' | 'oneshot' } = {}): Show {
  return {
    buses: [runtimeBus], effects: [effect()], presets: [], sections: [],
    graphs: {
      [padKey('d0', '0')]: {
        version: 3,
        nodes: [
          node('trigger', 'trigger'),
          node('effect', 'field', { effectId: 'fx', mode: options.mode ?? 'loop',
            params: { ...rich, warp: options.warp ?? 0.6 }, modInputs: [{ param: 'warp' }] }),
          node('audio', 'audio', { audioBand: 'bass' }),
          node('scope', 'scope', { scope: options.targetId ? 'hoop' : 'kit', targetId: options.targetId }),
          node('output', 'output'),
        ],
        edges: [
          { id: 'a', from: 'trigger', to: 'field' },
          { id: 'b', from: 'field', to: 'scope' },
          { id: 'c', from: 'scope', to: 'output' },
          ...(options.audio ? [{ id: 'mod', from: 'audio', to: 'field', toPort: 'param:warp' as const,
            amount: 1, invert: false, rangeMin: 0, rangeMax: 0.9 }] : []),
        ],
      },
    },
  };
}
function engine(options: Parameters<typeof show>[0] = {}) {
  const e = createVoiceBusEngine();
  e.setModel(buildPixelModel(spatialFixtureKit()));
  e.setShow(show(options));
  e.applyInput({ kind: 'noteOn', drumId: 'd0', zone: '0', velocity: 0.8, timeMs: 0 });
  e.tick(5, 5, runtimeFrame(5).transport);
  e.tick(25, 20, runtimeFrame(25).transport);
  e.frame();
  return e;
}
function paint(e: ReturnType<typeof engine>, time: number, dt: number): Float32Array {
  e.tick(time, dt, runtimeFrame(time).transport);
  return e.frame().slice();
}
function energy(frame: Readonly<Float32Array>): number { return frame.reduce((sum, v) => sum + v, 0); }

describe('Spatial Field through the normal registry/voice engine', () => {
  it('Audio bass drives live warp through the existing mapping and staleness path', () => {
    const modulated = engine({ audio: true, warp: 0 });
    const zero = engine({ warp: 0 });
    const full = engine({ warp: 0.9 });
    expect(modulated.frame()).toEqual(zero.frame());
    modulated.applyInput({ kind: 'audioFeatures', audio: { level: 0, bass: 1, mids: 0, highs: 0 }, timeMs: 60 });
    const active = paint(modulated, 60, 35);
    const expected = paint(full, 60, 35);
    const unmodulated = paint(zero, 60, 35);
    expect(active).toEqual(expected);
    expect(active).not.toEqual(unmodulated);
    expect(modulated.stats().voiceCount).toBe(1); // feature frames never spawn a voice
    const stale = paint(modulated, 561, 501);
    expect(stale).toEqual(paint(zero, 561, 501));
    expect(stale.every(Number.isFinite)).toBe(true);
  });

  it('Scope still masks a shared world field, including a non-source drum and disjoint hoops', () => {
    const scoped = engine({ targetId: 'd1#1,3' });
    const whole = engine();
    const actual = paint(scoped, 600, 575);
    const expected = paint(whole, 600, 575);
    const model = buildPixelModel(spatialFixtureKit());
    for (const p of model.pixels) {
      const selected = p.drumId === 'd1' && (p.hoopIndex === 1 || p.hoopIndex === 3);
      expect(actual.slice(p.id * 4, p.id * 4 + 4)).toEqual(selected
        ? expected.slice(p.id * 4, p.id * 4 + 4) : new Float32Array(4));
    }
    expect(energy(actual)).toBeGreaterThan(1);
  });

  it('an unrelated hit never enters the running voice; two own hits remain isolated voices', () => {
    const states = new Set<SpatialFieldState>();
    // The registry decorates a COPY with metadata; spy on the adapter the engine resolves,
    // not the undecorated implementation export (which would make this assertion vacuous).
    const registered = getEffect('spatial-field');
    const original = registered.render;
    const spy = vi.spyOn(registered, 'render').mockImplementation((ctx, params, fb, state) => {
      expect(ctx.triggers).toHaveLength(1);
      expect(ctx.triggers[0]!.drumId).toBe('d0');
      original(ctx, params, fb, state);
      const spatial = state as SpatialFieldState;
      expect(spatial.em.emissions).toHaveLength(1);
      states.add(spatial);
    });
    try {
      const actual = engine();
      const reference = engine();
      actual.applyInput({ kind: 'noteOn', drumId: 'd3', zone: '0', velocity: 1, timeMs: 90 });
      expect(paint(actual, 100, 75)).toEqual(paint(reference, 100, 75));
      expect(actual.stats().voiceCount).toBe(1);
      actual.applyInput({ kind: 'noteOn', drumId: 'd0', zone: '0', velocity: 0.3, timeMs: 110 });
      paint(actual, 120, 20);
      expect(actual.stats().voiceCount).toBe(2);
      expect(states.size).toBe(3); // two engines' first voice + the actual engine's second
      const caches = [...states].map((s) => s.geometry.normalized);
      expect(new Set(caches).size).toBe(3);
    } finally { spy.mockRestore(); }
  });

  it('one-shot sustain includes authored wave life; show replacement clears all voices', () => {
    const e = engine({ mode: 'oneshot' });
    expect(energy(paint(e, 1000, 975))).toBeGreaterThan(1);
    expect(e.stats().voiceCount).toBe(1);
    paint(e, 1700, 700);
    paint(e, 1800, 100);
    expect(e.stats().voiceCount).toBe(0);
    expect(energy(e.frame())).toBe(0);
    e.applyInput({ kind: 'noteOn', drumId: 'd0', zone: '0', velocity: 1, timeMs: 1810 });
    paint(e, 1820, 20);
    expect(e.stats().voiceCount).toBe(1);
    e.setShow(show());
    expect(energy(paint(e, 1830, 10))).toBe(0);
    expect(e.stats().voiceCount).toBe(0);
  });
});

describe('Spatial Field geometry/presentation/pool ownership', () => {
  it('same-count model replacement resets state in the production compositor', () => {
    const c = createDefaultCompositor();
    const action = runtimeAction({ params: rich });
    const v = runtimeVoice({}, action, 'spatial-field');
    const model = buildPixelModel(spatialFixtureKit());
    const draw = (voice: Voice, m: typeof model, time: number, compositor = c) => {
      const fb = new Framebuffer(m.pixelCount);
      applyEffectiveParams(voice, time, 120);
      compositor.render([voice], m, runtimeFrame(time), fb);
      return fb.rgba;
    };
    draw(v, model, 16);
    const old = v.genState;
    draw(v, model, 32);
    expect(v.genState).toBe(old);
    const kit = spatialFixtureKit();
    kit.drums.reverse();
    kit.drums[1]!.rotation.y += 90;
    const changed = buildPixelModel(kit);
    expect(changed.pixelCount).toBe(model.pixelCount);
    expect(draw(v, changed, 48)).toEqual(draw(runtimeVoice({}, action, 'spatial-field'), changed, 48, createDefaultCompositor()));
    expect(v.genState).not.toBe(old);
  });

  it('dirty same-tick edits and resume equal exactly one final render per tick', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const action = runtimeAction({ params: { ...rich } });
    const actual = runtimeVoice({}, action, 'spatial-field');
    const expected = runtimeVoice({}, action, 'spatial-field');
    const compositor = createDefaultCompositor(), reference = createDefaultCompositor();
    const fb = new Framebuffer(model.pixelCount), ref = new Framebuffer(model.pixelCount);
    for (let tick = 1; tick <= 5; tick++) {
      const frame = runtimeFrame(tick * 32, 32);
      for (const warpMode of ['swirl', 'ripple']) {
        actual.params.warpMode = warpMode;
        actual.params.warp = 0.9;
        applyEffectiveParams(actual, frame.timeMs, 120);
        compositor.renderPresentation([actual], model, frame, fb, tick);
      }
      actual.params.warp = expected.params.warp = 0.4;
      actual.params.warpMode = expected.params.warpMode = 'swirl';
      applyEffectiveParams(actual, frame.timeMs, 120);
      applyEffectiveParams(expected, frame.timeMs, 120);
      compositor.renderPresentation([actual], model, frame, fb, tick);
      reference.render([expected], model, frame, ref);
      expect(fb.rgba).toEqual(ref.rgba);
      expect((actual.genState as SpatialFieldState).em).toEqual((expected.genState as SpatialFieldState).em);
    }
  });

  it('reaping drops geometry-sized state and a reused pool slot gets a fresh cache/emitter', () => {
    const model = buildPixelModel(spatialFixtureKit());
    const pool = new VoicePool();
    const deps = { effectsById: new Map([['fx', effect()]]), busById: new Map([['b', runtimeBus]]), latched: new Map<string, string | null>(), timeMs: 0, bpm: 120 };
    const action = runtimeAction({ params: rich, mode: 'oneshot' });
    const v = pool.spawn(action, 'd0', 0.8, deps)!;
    v.level = 1;
    const c = createDefaultCompositor();
    const fb = new Framebuffer(model.pixelCount);
    applyEffectiveParams(v, 16, 120);
    c.render([v], model, runtimeFrame(16), fb);
    const oldState = v.genState;
    expect(oldState).not.toBeNull();
    releaseVoice(v, 16);
    advanceEnvelopes(pool.pool, 200, deps.busById);
    reapDeadVoices(pool.pool, deps.latched);
    expect(v.genState).toBeNull();
    expect(v.renderModel).toBeUndefined();
    expect(v.active).toBe(false);
    deps.timeMs = 200;
    const reused = pool.spawn(action, 'd0', 0.8, deps)!;
    expect(reused).toBe(v);
    reused.level = 1;
    applyEffectiveParams(reused, 216, 120);
    c.render([reused], model, runtimeFrame(216), fb);
    expect(reused.genState).not.toBe(oldState);
    expect((reused.genState as SpatialFieldState).em.emissions).toHaveLength(1);
    const freshPool = new VoicePool();
    const fresh = freshPool.spawn(action, 'd0', 0.8, deps)!;
    fresh.level = 1;
    applyEffectiveParams(fresh, 216, 120);
    const ref = new Framebuffer(model.pixelCount);
    createDefaultCompositor().render([fresh], model, runtimeFrame(216), ref);
    expect(fb.rgba).toEqual(ref.rgba);
  });
});
