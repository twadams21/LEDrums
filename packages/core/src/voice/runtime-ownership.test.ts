import { describe, expect, it, vi } from 'vitest';
import { registerCanvasScene, unregisterCanvasScene } from '../canvas/registry';
import { tryGetEffect } from '../effects/registry';
import { Framebuffer } from '../engine/framebuffer';
import { createDefaultCompositor } from './compositor';
import { createRenderCheckpoint } from './render-checkpoint';
import { ensureGeometryState } from './geometry-state';
import { deactivateVoice, VoicePool } from './voice-pool';
import { runtimeAction, runtimeBus, runtimeEffect, runtimeFrame, runtimeModel, runtimeVoice } from './runtime-test-fixtures';

const scene = { id: 'runtime-owner', name: 'Owner', sampler: { kind: 'strip' as const }, elements: [] };

describe('non-rendering presentation ownership', () => {
  for (const change of ['dead', 'absent', 'id', 'seed', 'birth', 'slot-reset', 'object', 'model', 'null', 'reset'] as const) {
    it(`prunes ${change} without capturing/rewinding an unchanged live baseline`, () => {
      const checkpoint = createRenderCheckpoint();
      const model = runtimeModel();
      const active = runtimeVoice({ renderModel: model, genState: new Float32Array([10]) });
      let retired = runtimeVoice({ renderModel: model, genState: new Float32Array([20]) });
      checkpoint([active, retired], model, 1);
      const live = active.genState as Float32Array;
      live[0] = 11;
      if (change === 'dead') retired.active = false;
      if (change === 'id') retired.id += '-new';
      if (change === 'seed') retired.seed++;
      if (change === 'birth') retired.bornAtMs++;
      if (change === 'slot-reset') { deactivateVoice(retired); retired.active = true; }
      if (change === 'object') retired = { ...retired };
      const revision = change === 'model' ? runtimeModel() : change === 'null' ? null : model;
      if (change === 'reset') checkpoint.reset();
      else checkpoint.prune(change === 'absent' ? [active] : [active, retired], revision);
      // Pruning is ownership-only: no capture, clone, restore or generator execution.
      expect(active.genState).toBe(live);
      expect(live[0]).toBe(11);
      retired.active = true;
      ensureGeometryState(retired, model);
      retired.genState = new Float32Array([30]);
      checkpoint([active, retired], model, 1);
      (retired.genState as Float32Array)[0] = 99;
      checkpoint([active, retired], model, 1);
      expect(retired.genState).toEqual(new Float32Array([30]));
      expect(active.genState).toEqual(new Float32Array(['model', 'null', 'reset'].includes(change) ? [11] : [10]));
    });
  }

  it('keeps an active Echo journal baseline across prune and a dirty same-tick replay', () => {
    const model = runtimeModel([16]);
    const actual = runtimeVoice({ modifiers: [{ modifierId: 'echo', params: { delayMs: 16 } }] }, runtimeAction(), 'solid-colour');
    const expected = runtimeVoice({ modifiers: [{ modifierId: 'echo', params: { delayMs: 16 } }] }, runtimeAction(), 'solid-colour');
    const compositor = createDefaultCompositor();
    const reference = createDefaultCompositor();
    const dst = new Framebuffer(model.pixelCount), ref = new Framebuffer(model.pixelCount);
    for (let tick = 0; tick < 4; tick++) {
      const frame = runtimeFrame(tick * 16);
      actual.liveParams.brightness = 0.9;
      compositor.renderPresentation([actual], model, frame, dst, tick);
      const state = actual.modState;
      const ring = (state![0] as { buf: Float32Array }).buf;
      const before = ring.slice();
      const render = vi.spyOn(compositor, 'render');
      compositor.prunePresentation([actual], model);
      expect(render).not.toHaveBeenCalled();
      render.mockRestore();
      expect(actual.modState).toBe(state);
      expect(ring).toEqual(before);
      actual.liveParams.brightness = expected.liveParams.brightness = 0.1;
      compositor.renderPresentation([actual], model, frame, dst, tick);
      reference.render([expected], model, frame, ref);
      expect(dst.rgba).toEqual(ref.rgba);
      expect(actual.modState).toEqual(expected.modState);
    }
  });

  for (const model of [runtimeModel([4]), null]) {
    it(`releases all geometry state without rendering on model ${model ? 'replacement' : 'removal'}`, () => {
      const old = runtimeModel([4]);
      const member = { renderModel: old, renderGenerator: tryGetEffect('solid-colour'), genState: { model: old }, modState: [new Float32Array(4)] };
      const v = runtimeVoice({ ...member, mixInputs: [], spliceInputs: [] });
      // GeometryState supports nested ownership independent of concrete member metadata.
      const state = { ...v, mixInputs: [member], spliceInputs: [{ ...member }] };
      ensureGeometryState(state, model);
      for (const owner of [state, ...state.mixInputs, ...state.spliceInputs]) {
        expect(owner.renderModel).toBe(model ?? undefined);
        expect(owner.renderGenerator).toBeUndefined();
        expect(owner.genState).toBeNull();
        expect(owner.modState).toBeUndefined();
      }
    });
  }
});

describe('Canvas adapter pool ownership (plain core rendering)', () => {
  for (const retirement of ['deactivate', 'reset', 'inactive-reuse', 'steal-to-mix'] as const) {
    it(`clears the adapter on ${retirement}, without a presentation`, () => {
      registerCanvasScene(scene);
      try {
        const pool = new VoicePool();
        const deps = { effectsById: new Map([['fx', runtimeEffect(`canvas:${scene.id}`)]]), busById: new Map([['b', runtimeBus]]), latched: new Map(), timeMs: 0, bpm: 120 };
        const v = pool.spawn(runtimeAction(), 'd0', 1, deps)!;
        v.level = 1;
        const model = runtimeModel();
        createDefaultCompositor().render([v], model, runtimeFrame(16), new Framebuffer(model.pixelCount));
        expect(v.renderGenerator).toBe(tryGetEffect(`canvas:${scene.id}`));
        expect(v.genState).not.toBeNull();
        unregisterCanvasScene(scene.id);
        if (retirement === 'deactivate') deactivateVoice(v);
        if (retirement === 'reset') pool.reset();
        if (retirement === 'inactive-reuse') {
          v.active = false; // exercise spawn reset independently of deactivateVoice
          expect(pool.spawn(runtimeAction(), 'd0', 1, deps)).toBe(v);
        }
        if (retirement === 'steal-to-mix') {
          for (let i = 1; i < pool.pool.length; i++) pool.spawn(runtimeAction(), 'd0', 1, deps);
          expect(pool.spawn(runtimeAction({ mixInputs: [{ ...runtimeAction(), opacity: 1, originNodeId: 'member' }] }), 'd0', 1, deps)).toBe(v);
          expect(v.mixInputs).toHaveLength(1);
        }
        expect(v.renderGenerator).toBeUndefined();
        expect(v.renderModel).toBeUndefined();
        expect(v.genState).toBeNull();
        expect(v.modState).toBeUndefined();
      } finally { unregisterCanvasScene(scene.id); }
    });
  }
});
