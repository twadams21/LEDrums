import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { applyEffectiveParams, createDefaultCompositor } from './compositor';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeSplice, runtimeVoice } from './runtime-test-fixtures';
import type { Voice } from './types';

describe('live geometry replacement', () => {
  for (const generator of ['pixel-accum', 'confetti-burst']) {
    for (const modifierId of ['feedback', 'echo']) {
      for (const composite of ['ordinary', 'mix', 'splice'] as const) {
        it(`${generator}/${modifierId}/${composite}: grow, shrink and equal-total reorder reset to a fresh render`, () => {
          const action = runtimeAction({ modifiers: [{ modifierId, params: {}, bypass: false }] });
          if (composite !== 'ordinary') {
            const member = { ...action, opacity: 1, originNodeId: 'member' };
            if (composite === 'mix') action.mixInputs = [member];
            else { action.spliceInputs = [member]; action.splice = runtimeSplice(); }
          }
          const v = runtimeVoice({}, action, generator);
          const compositor = createDefaultCompositor();
          const render = (voice: Voice, model: ReturnType<typeof runtimeModel>, time: number, c = compositor) => {
            applyEffectiveParams(voice, time, 120);
            const fb = new Framebuffer(model.pixelCount);
            c.render([voice], model, runtimeFrame(time), fb);
            return fb.rgba;
          };
          const firstModel = runtimeModel();
          render(v, firstModel, 16);
          const stateOf = () => (v.spliceInputs?.[0] ?? v.mixInputs?.[0] ?? v).genState;
          let previousState = stateOf();
          render(v, firstModel, 32);
          expect(stateOf()).toBe(previousState); // unchanged geometry retains trails/particles
          let time = 48;
          for (const model of [runtimeModel([8, 8]), runtimeModel([2, 2]), runtimeModel([2, 2], true)]) {
            const actual = render(v, model, time);
            const fresh = runtimeVoice({}, action, generator);
            const expected = render(fresh, model, time, createDefaultCompositor());
            expect([...actual].every(Number.isFinite)).toBe(true);
            expect(actual).toEqual(expected);
            expect(stateOf()).not.toBe(previousState);
            previousState = stateOf();
            time += 16;
          }
        });
      }
    }
  }
});
