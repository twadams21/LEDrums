import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { applyEffectiveParams, createDefaultCompositor } from './compositor';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeSplice, runtimeVoice } from './runtime-test-fixtures';
import type { MixInput } from './types';
import { advanceEnvelopes } from './envelope-tick';

const flat = { profile: 'bend' as const, strength: 0, h0: { x: 0, y: 1 }, h1: { x: 1, y: 1 } };

describe('authored decay metadata through composite members', () => {
  for (const shape of ['direct', 'mix', 'splice'] as const) {
    it(`${shape}: keeps authored curve × host attack × deck × member brightness/opacity/unit envelope`, () => {
      const model = runtimeModel();
      const params = { brightness: 0.8, hue: 0, saturation: 1, decayMs: 220 };
      const v = runtimeVoice({ mode: 'oneshot', attackMs: 440, sustainMs: 1000, lifeSpanMs: 1000, deckGain: 0.5,
        lifeEnvelope: { ...flat, h0: { x: 0, y: 0.5 }, h1: { x: 1, y: 0.5 } } }, runtimeAction({ params }), 'whole-drum');
      if (shape !== 'direct') {
        const member: MixInput = { scope: 'kit', sourceDrumId: 'd0', velocity: 1, seed: 1,
          generatorId: 'whole-drum', genState: null, params, liveParams: {}, specs: [], opacity: 0.5 };
        if (shape === 'mix') { v.mixInputs = [member]; v.mixBlendMode = 'normal'; }
        else {
          v.spliceInputs = [member]; v.splice = runtimeSplice();
          v.splice.waitMode = 'pulse';
          v.splice.envelope.attackMs = 440;
        }
      }
      advanceEnvelopes([v], 220, new Map());
      expect(v.level).toBe(0.25); // half-way through attack × authored 0.5
      const fb = new Framebuffer(model.pixelCount);
      applyEffectiveParams(v, 220, 120);
      createDefaultCompositor().render([v], model, runtimeFrame(220), fb);
      expect(fb.rgba[0]).toBeCloseTo(0.25 * 0.5 * 0.8 * (shape === 'direct' ? 1 : 0.5), 6);
    });
    for (const authored of [false, true]) for (const gain of [1, 0.5]) {
      it(`${shape}/${gain}: ${authored ? 'authored shape suppresses' : 'un-authored keeps'} natural fade without doubling host gain`, () => {
        const model = runtimeModel();
        const params = { brightness: 1, hue: 0, saturation: 1, decayMs: 220 };
        const v = runtimeVoice({ level: gain, deckGain: gain }, runtimeAction({ params }), 'whole-drum');
        if (authored) v.lifeEnvelope = flat;
        if (shape !== 'direct') {
          const member: MixInput = { scope: 'kit', sourceDrumId: 'd0', velocity: 1, seed: 1,
            generatorId: 'whole-drum', genState: null, params, liveParams: {}, specs: [], opacity: 1 };
          if (shape === 'mix') { v.mixInputs = [member]; v.mixBlendMode = 'normal'; }
          else { v.spliceInputs = [member]; v.splice = runtimeSplice(); }
        }
        const fb = new Framebuffer(model.pixelCount);
        applyEffectiveParams(v, 220, 120);
        createDefaultCompositor().render([v], model, runtimeFrame(220), fb);
        // Host level × deck gain is applied ONCE, outside the member. Normal Mix
        // also composites the generator's natural alpha (the existing blend contract).
        expect(fb.rgba[0]).toBeCloseTo(gain * gain * (authored ? 1 : Math.exp(shape === 'mix' ? -2 : -1)), 6);
        if (authored && gain === 1) expect(Math.round(fb.rgba[0]! * 255)).toBe(255);
      });
    }
  }
});
