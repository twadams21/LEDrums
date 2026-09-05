import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { listEffects, tryGetEffect } from '../effects/registry';
import { registerCanvasScene, unregisterCanvasScene } from '../canvas/registry';
import type { CanvasScene } from '../canvas/types';
import { defaultParams } from '../effects/types';
import { mulberry32 } from '../math';
import { listModifiers } from '../modifiers/registry';
import { createDefaultCompositor, applyEffectiveParams } from './compositor';
import { cloneRenderState, createRenderCheckpoint } from './render-checkpoint';
import { Prng } from './prng';
import { runtimeAction, runtimeFrame, runtimeHoopModel, runtimeModel, runtimeVoice } from './runtime-test-fixtures';

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
    const falseFork = Object.assign(() => 1, { clone: () => falseFork });
    expect(() => cloneRenderState(falseFork, model)).toThrow('did not fork');
  });

  it('reuses live backing stores while preserving changing aliases, cycles, views, maps and sets', () => {
    const checkpoint = createRenderCheckpoint();
    const data = new Float32Array([1, 2, 3, 4]);
    const initial = { data, alias: data, view: new DataView(data.buffer, 4, 8), model,
      map: new Map<object, unknown>(), set: new Set<object>(), removed: 1 as number | undefined };
    initial.map.set(initial, initial);
    initial.set.add(initial);
    const voice = runtimeVoice({ renderModel: model, genState: initial });
    for (let tick = 0; tick < 5; tick++) {
      const state = voice.genState as typeof initial;
      if (tick > 0) {
        // A formerly aliased field splits, then rejoins on the following tick.
        state.alias = tick % 2 ? new Float32Array([5, 6]) : state.data;
        delete state.removed;
      }
      const baseline = cloneRenderState(state, model);
      checkpoint([voice], model, tick);
      const liveBuffer = state.data.buffer;
      for (let paint = 0; paint < 3; paint++) {
        const current = voice.genState as typeof initial;
        current.data.fill(99);
        current.alias.fill(77);
        current.map.clear();
        current.set.clear();
        checkpoint([voice], model, tick);
        const restored = voice.genState as typeof initial;
        expect(restored).toEqual(baseline);
        expect(restored.data.buffer).toBe(liveBuffer);
        expect(restored.view.buffer).toBe(restored.data.buffer);
        expect(restored.model).toBe(model);
        expect(restored.map.get(restored)).toBe(restored);
        expect(restored.set.has(restored)).toBe(true);
        expect(restored.alias === restored.data).toBe(tick % 2 === 0);
      }
    }
  });

  it('reusable checkpoints fork both RNG carriers; dirty restores never move either baseline', () => {
    const checkpoint = createRenderCheckpoint();
    const voice = runtimeVoice({ renderModel: model, genState: { fn: mulberry32(7), prng: new Prng(8) } });
    const reference = { fn: mulberry32(7), prng: new Prng(8) };
    for (let tick = 0; tick < 12; tick++) {
      checkpoint([voice], model, tick);
      const fn = reference.fn.clone();
      const prng = reference.prng.clone();
      const expected = Array.from({ length: 17 }, () => [fn(), prng.next()]);
      for (let paint = 0; paint < 5; paint++) {
        checkpoint([voice], model, tick);
        const state = voice.genState as typeof reference;
        expect(Array.from({ length: 17 }, () => [state.fn(), state.prng.next()])).toEqual(expected);
      }
      for (let i = 0; i < 17; i++) { reference.fn(); reference.prng.next(); }
    }
  });

  it('does not infer an Echo journal from a lookalike data shape', () => {
    const checkpoint = createRenderCheckpoint();
    const fake = { buf: new Float32Array(64 * 4), rangeLen: 1, pos: 0 };
    const voice = runtimeVoice({ renderModel: model, modState: [fake] });
    checkpoint([voice], model, 0);
    fake.buf[63 * 4] = 1; // not the slot an actual Echo would overwrite
    checkpoint([voice], model, 0);
    expect((voice.modState![0] as typeof fake).buf.every((v) => v === 0)).toBe(true);
  });

  for (const replacement of ['dead', 'absent', 'id', 'seed', 'bornAtMs', 'object'] as const) {
    it(`drops the previous checkpoint on ${replacement} ownership change, even in the same tick`, () => {
      const checkpoint = createRenderCheckpoint();
      let voice = runtimeVoice({ renderModel: model, genState: new Float32Array([1]) });
      checkpoint([voice], model, 0);
      if (replacement === 'dead') { voice.active = false; checkpoint([voice], model, 0); voice.active = true; }
      if (replacement === 'absent') checkpoint([], model, 0);
      if (replacement === 'id') voice.id = 'v-new';
      if (replacement === 'seed') voice.seed++;
      if (replacement === 'bornAtMs') voice.bornAtMs++;
      if (replacement === 'object') voice = runtimeVoice({ renderModel: model });
      voice.genState = new Float32Array([2]);
      checkpoint([voice], model, 0);
      (voice.genState as Float32Array)[0] = 3;
      checkpoint([voice], model, 0);
      expect(voice.genState).toEqual(new Float32Array([2]));
    });
  }

  it('Echo journal survives three committed ring wraps, bypass/empty-scope/level gates and changing delay/dt/input', () => {
    const model = runtimeHoopModel(4, 8);
    const actual = runtimeVoice({ modifiers: [{ modifierId: 'echo', params: {} }] }, runtimeAction(), 'solid-colour');
    const expected = runtimeVoice({ modifiers: [{ modifierId: 'echo', params: {} }] }, runtimeAction(), 'solid-colour');
    const compositor = createDefaultCompositor();
    const reference = createDefaultCompositor();
    const fb = new Framebuffer(model.pixelCount);
    const ref = new Framebuffer(model.pixelCount);
    let committedWrites = 0;
    for (let tick = 0; tick < 320; tick++) {
      const frame = runtimeFrame(tick * 16, [8, 16, 33][tick % 3]);
      for (let paint = 0; paint < 5; paint++) {
        actual.level = 1;
        actual.liveParams.brightness = paint / 10;
        actual.modifiers![0]!.bypass = paint % 2 === 0;
        actual.modifiers![0]!.params.delayMs = paint * 500;
        actual.scope = 'hoop';
        actual.targetId = paint % 2 ? 'd0#1,3' : 'missing#1';
        compositor.renderPresentation([actual], model, frame, fb, tick);
      }
      for (const v of [actual, expected]) {
        v.liveParams.brightness = (tick % 11) / 100;
        v.modifiers![0]!.bypass = tick % 9 === 0;
        v.modifiers![0]!.params = { delayMs: [0, 16, 1000, 32][tick % 4]!, feedback: 0.3 };
        v.scope = 'hoop';
        v.targetId = tick % 13 === 0 ? 'missing#1' : 'd0#1,3';
        v.level = tick % 7 === 0 ? 0 : 1;
      }
      compositor.renderPresentation([actual], model, frame, fb, tick);
      const position = (): number => (expected.modState?.[0] as { pos: number } | undefined)?.pos ?? 0;
      const before = position();
      reference.render([expected], model, frame, ref);
      if (position() !== before) {
        expect(position()).toBe((before + 1) % 64);
        committedWrites++;
      }
      expect(fb.rgba, `frame ${tick}`).toEqual(ref.rgba);
      expect(actual.modState, `whole ring ${tick}`).toEqual(expected.modState);
    }
    // Count real final-candidate applies via the reference cursor, NOT attempted ticks
    // or dirty candidates. Gates made the former 145-tick test only 101 writes (one wrap).
    expect(committedWrites).toBe(225);
    expect(committedWrites).toBeGreaterThanOrEqual(3 * 64);
  });

  for (const key of ['mixInputs', 'spliceInputs'] as const) {
    it(`${key}: replaced/removed members never inherit or resurrect old checkpoints`, () => {
      const action = runtimeAction({ mixInputs: [{ ...runtimeAction(), opacity: 1, originNodeId: 'member' }] });
      const voice = runtimeVoice({ renderModel: model }, action);
      const member = voice.mixInputs![0]!;
      voice.mixInputs = undefined;
      voice[key] = [member];
      member.genState = new Float32Array([1]);
      const checkpoint = createRenderCheckpoint();
      checkpoint([voice], model, 0);
      const replacement = { ...member, genState: new Float32Array([2]) };
      voice[key] = [replacement];
      checkpoint([voice], model, 0);
      replacement.genState[0] = 99;
      checkpoint([voice], model, 0);
      expect(replacement.genState).toEqual(new Float32Array([2]));
      voice[key] = undefined;
      checkpoint([voice], model, 0);
      member.genState = new Float32Array([3]);
      voice[key] = [member];
      checkpoint([voice], model, 0);
      (member.genState as Float32Array)[0] = 99;
      checkpoint([voice], model, 0);
      expect(member.genState).toEqual(new Float32Array([3]));
    });
  }

  for (const tick of [0, 1]) {
    it(`registry replacement/removal discards retired checkpoint payloads before copying (tick ${tick})`, () => {
      const scene: CanvasScene = { id: 'checkpoint-retirement', name: 'Retirement', sampler: { kind: 'strip' }, elements: [] };
      registerCanvasScene(scene);
      try {
        const id = `canvas:${scene.id}`;
        const voice = runtimeVoice({ renderModel: model, renderGenerator: tryGetEffect(id),
          genState: new Float32Array([1, 2, 3]),
        }, runtimeAction(), id);
        const checkpoint = createRenderCheckpoint();
        checkpoint([voice], model, 0);
        registerCanvasScene({ ...scene, name: 'Replacement' });
        checkpoint([voice], model, tick);
        expect(voice.genState).toBeNull();
        expect(voice.renderGenerator).toBe(tryGetEffect(id));
        unregisterCanvasScene(scene.id);
        checkpoint([voice], model, tick);
        expect(voice.genState).toBeNull();
        expect(voice.renderGenerator).toBeUndefined();
      } finally { unregisterCanvasScene(scene.id); }
    });
  }

  for (const modifierId of ['echo', 'feedback']) {
    it(`${modifierId}: grow, shrink and equal-count model replacements discard old histories`, () => {
      const actual = runtimeVoice({ modifiers: [{ modifierId, params: { delayMs: 16 } }] }, runtimeAction(), 'solid-colour');
      const compositor = createDefaultCompositor();
      for (const counts of [[16], [32, 32], [8], [4, 4], [8]]) {
        const revision = runtimeModel(counts);
        const expected = runtimeVoice({ modifiers: [{ modifierId, params: { delayMs: 16 } }] }, runtimeAction(), 'solid-colour');
        const reference = createDefaultCompositor();
        const dst = new Framebuffer(revision.pixelCount);
        const ref = new Framebuffer(revision.pixelCount);
        // Keep the tick equal across model replacements to exercise the geometry fence.
        for (let paint = 0; paint < 3; paint++) compositor.renderPresentation([actual], revision, runtimeFrame(16), dst, 1);
        reference.render([expected], revision, runtimeFrame(16), ref);
        expect(dst.rgba).toEqual(ref.rgba);
        expect(actual.modState).toEqual(expected.modState);
        compositor.renderPresentation([actual], revision, runtimeFrame(32), dst, 2);
      }
    });
  }
});
