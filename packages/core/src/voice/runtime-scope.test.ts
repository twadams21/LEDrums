import { afterEach, describe, expect, it, vi } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { getEffect } from '../effects/registry';
import { tryGetModifier } from '../modifiers/registry';
import { applyEffectiveParams, createDefaultCompositor } from './compositor';
import { runtimeAction, runtimeFrame, runtimeHoopModel, runtimeSplice, runtimeVoice } from './runtime-test-fixtures';
import type { Voice } from './types';

afterEach(() => vi.restoreAllMocks());

function scopedVoice(composite: string, scope: Voice['scope'], targetId?: string, modifierId?: string) {
  const modifiers = modifierId ? [{ modifierId, params: { shift: 1, offset: 1, delayMs: 32, brightness: 0.5 }, bypass: false }] : undefined;
  const action = runtimeAction({ scope, targetId, modifiers });
  const member = { ...action, opacity: 1, originNodeId: 'member' };
  if (composite === 'mix') action.mixInputs = [member];
  if (composite === 'splice') { action.spliceInputs = [member]; action.splice = runtimeSplice(); }
  return runtimeVoice({}, action);
}

describe('generate once, then mask the pixel set', () => {
  it.each(['echo', 'grain', 'sparkle'])('%s advances once over full output with real dt, then unselected pixels stay dark', (modifierId) => {
    const apply = vi.spyOn(tryGetModifier(modifierId)!, 'apply');
    const model = runtimeHoopModel(4, 32);
    const v = scopedVoice('ordinary', 'hoop', 'd0#3,1', modifierId);
    const c = createDefaultCompositor();
    const fb = new Framebuffer(model.pixelCount);
    for (let t = 16; t <= 64; t += 16) {
      applyEffectiveParams(v, t, 120);
      c.render([v], model, runtimeFrame(t), fb);
      for (const pixel of [...Array.from({ length: 8 }, (_, i) => i + 8), ...Array.from({ length: 8 }, (_, i) => i + 24)]) {
        expect(fb.rgba.slice(pixel * 4, pixel * 4 + 4)).toEqual(new Float32Array(4));
      }
    }
    expect(apply).toHaveBeenCalledTimes(4);
    for (const [ctx, , , range] of apply.mock.calls) {
      expect(ctx.dt).toBe(16);
      expect(range).toEqual({ start: 0, end: 32 });
    }
  });
  for (const composite of ['ordinary', 'mix', 'splice']) {
    for (const hoops of [1, 4, 16]) {
      it(`${composite}: ${hoops} selected hoops call the generator once per tick`, () => {
        const spy = vi.spyOn(getEffect('pixel-accum'), 'render');
        const model = runtimeHoopModel(16);
        // Fixed geometry; four selected hoops are deliberately disjoint, so merely
        // coalescing adjacent ranges cannot hide repeated generation.
        const v = scopedVoice(composite, 'hoop', `d0#${Array.from({ length: hoops }, (_, i) => i * (16 / hoops) + 1).join(',')}`);
        const c = createDefaultCompositor();
        for (let t = 16; t <= 48; t += 16) {
          applyEffectiveParams(v, t, 120);
          c.render([v], model, runtimeFrame(t), new Framebuffer(model.pixelCount));
        }
        expect(spy).toHaveBeenCalledTimes(3);
      });
    }
    for (const modifier of [undefined, 'feedback', 'echo', 'slide', 'levels']) {
      it(`${composite}/${modifier}: equivalent scope sets and reverse selection order have identical frames`, () => {
        const model = runtimeHoopModel(4, 32);
        const run = (scope: Voice['scope'], target?: string) => {
          const v = scopedVoice(composite, scope, target, modifier);
          const c = createDefaultCompositor();
          const fb = new Framebuffer(model.pixelCount);
          const frames: Float32Array[] = [];
          for (let t = 16; t <= 128; t += 16) {
            applyEffectiveParams(v, t, 120);
            c.render([v], model, runtimeFrame(t), fb);
            frames.push(fb.rgba.slice());
          }
          return frames;
        };
        expect(run('hoop', 'd0#1,2,3,4')).toEqual(run('kit'));
        expect(run('hoop', 'd0#4,2,1,3')).toEqual(run('kit'));
        expect(run('hoop', 'd0#3,1')).toEqual(run('hoop', 'd0#1,3'));
      });
    }
  }
});
