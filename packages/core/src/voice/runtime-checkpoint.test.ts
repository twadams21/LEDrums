import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { listEffects } from '../effects/registry';
import { defaultParams } from '../effects/types';
import { mulberry32 } from '../math';
import { listModifiers } from '../modifiers/registry';
import { createDefaultCompositor, applyEffectiveParams } from './compositor';
import { cloneRenderState } from './render-checkpoint';
import { runtimeAction, runtimeFrame, runtimeHoopModel, runtimeVoice } from './runtime-test-fixtures';

// Real generators/modifiers, not synthetic counters: covers closure RNGs (Sacred Hogs
// consumes on EVERY render), class RNGs (Sparkle), emitter ages/particles, ring histories,
// typed arrays, Framebuffer methods, Map state and immutable grid/model references.
describe('pre-advance presentation checkpoints', () => {
  const model = runtimeHoopModel(4, 64);
  function stateDigest(state: unknown): string | undefined {
    return JSON.stringify(state, (_key, value: unknown) => {
      if (value === model) return '<immutable model>';
      if (typeof value === 'function') {
        if (!('clone' in value) || typeof value.clone !== 'function') throw new Error('non-forkable test state');
        const fork = value.clone() as () => number;
        return Array.from({ length: 8 }, () => fork());
      }
      if (value instanceof Map) return [...value];
      if (value instanceof Set) return [...value];
      return value;
    });
  }
  for (const generator of listEffects()) {
    it(`${generator.id}: dirty presentations and resume equal one final render per tick`, () => {
      const action = runtimeAction({ params: defaultParams(generator.paramSpec) });
      const actual = runtimeVoice({}, action, generator.id);
      const expected = runtimeVoice({}, action, generator.id);
      const compositor = createDefaultCompositor();
      const reference = createDefaultCompositor();
      const fb = new Framebuffer(model.pixelCount);
      const ref = new Framebuffer(model.pixelCount);
      for (let tick = 1; tick <= 6; tick++) {
        const frame = runtimeFrame(tick * 16);
        if (tick <= 4) for (const brightness of [0, 0.1, 0.7, 0.3]) {
          actual.params.brightness = brightness;
          applyEffectiveParams(actual, frame.timeMs, 120);
          compositor.renderPresentation([actual], model, frame, fb, tick);
        }
        actual.params.brightness = expected.params.brightness = 0.6;
        applyEffectiveParams(actual, frame.timeMs, 120);
        applyEffectiveParams(expected, frame.timeMs, 120);
        compositor.renderPresentation([actual], model, frame, fb, tick);
        reference.render([expected], model, frame, ref);
        expect(fb.rgba, `tick ${tick}`).toEqual(ref.rgba);
        // Invisible particles/emissions still count: compare histories AND future RNG
        // samples, not only the currently lit bytes.
        expect(stateDigest(actual.genState), `hidden state tick ${tick}`).toEqual(stateDigest(expected.genState));
      }
    });
  }
  for (const modifier of listModifiers()) {
    it(`${modifier.id}: preserves scoped modifier state across dirty presentations and resume`, () => {
      const action = runtimeAction({ params: { brightness: 0.6 } });
      const modifiers = [{ modifierId: modifier.id, params: defaultParams(modifier.paramSpec) }];
      const actual = runtimeVoice({ modifiers, scope: 'hoop', targetId: 'd0#1,3' }, action, 'sacred-hogs');
      const expected = runtimeVoice({ modifiers, scope: 'hoop', targetId: 'd0#1,3' }, action, 'sacred-hogs');
      const compositor = createDefaultCompositor();
      const reference = createDefaultCompositor();
      const fb = new Framebuffer(model.pixelCount);
      const ref = new Framebuffer(model.pixelCount);
      for (let tick = 1; tick <= 8; tick++) {
        const frame = runtimeFrame(tick * 16);
        applyEffectiveParams(actual, frame.timeMs, 120);
        applyEffectiveParams(expected, frame.timeMs, 120);
        for (let paint = 0; paint < (tick <= 4 ? 5 : 1); paint++) compositor.renderPresentation([actual], model, frame, fb, tick);
        reference.render([expected], model, frame, ref);
        expect(fb.rgba, `tick ${tick}`).toEqual(ref.rgba);
        expect(stateDigest(actual.modState), `hidden state tick ${tick}`).toEqual(stateDigest(expected.modState));
      }
    });
  }
  it('forks callable RNG cursors without advancing the source or changing the sequence', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 17; i++) rng();
    const fork = cloneRenderState(rng, model);
    expect(fork).not.toBe(rng);
    expect(Array.from({ length: 100 }, () => fork())).toEqual(Array.from({ length: 100 }, () => rng()));
  });
  it('preserves aliases, cycles, typed-array views and immutable model identities', () => {
    const array = new Float32Array([1, 2, 3, 4]);
    const original = { array, alias: array, view: array.subarray(1), model, map: new Map<object, unknown>() };
    original.map.set(original, original);
    const clone = cloneRenderState(original, model);
    expect(clone.model).toBe(model);
    expect(clone.array).not.toBe(array);
    expect(clone.alias).toBe(clone.array);
    expect(clone.view.buffer).toBe(clone.array.buffer);
    expect(clone.map.get(clone)).toBe(clone);
    clone.view[0] = 12;
    expect(clone.array[1]).toBe(12);
    expect(array[1]).toBe(2);
  });
  it('refuses opaque closures/classes rather than silently sharing mutable state', () => {
    expect(() => cloneRenderState({ rng: () => 1 }, model)).toThrow('non-forkable');
    expect(() => cloneRenderState({ opaque: new WeakMap() }, model)).toThrow('opaque');
  });
});
