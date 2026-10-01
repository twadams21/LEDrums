import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import type { PixelModel } from '../geometry/pixel-model';
import { applyModifierChain } from '../modifiers/chain';
import { applyEffectiveParams } from '../voice/compositor';
import type { Voice } from '../voice/types';
import { hasTempoParams, isTempoUnit, resolveTempoParams, tempoKey, tempoValue } from './tempo';

/* Beats on every duration and rate (Tim, 2026-10-02). */
describe('the rule', () => {
  it('a duration lasts its beats; a rate runs one cycle per its beats', () => {
    expect(tempoValue('ms', 0.5, 120)).toBe(250);
    expect(tempoValue('ms', 1, 60)).toBe(1000);
    expect(tempoValue('Hz', 0.5, 120)).toBe(4); // one cycle per 1/8 at 120 bpm
    expect(tempoValue('Hz', 2, 120)).toBe(1);
    expect(tempoValue('mm', 1, 120)).toBeNull();
    expect(isTempoUnit('ms') && isTempoUnit('Hz') && !isTempoUnit('°')).toBe(true);
  });

  it('writes each companion over its param, clamped to the param’s range; the ms stays a fallback', () => {
    const params: Record<string, unknown> = { delayMs: 300, [tempoKey('delayMs')]: 1, rate: 2, other: 5 };
    resolveTempoParams(params, [{ key: 'delayMs', unit: 'ms', min: 0, max: 2000 }, { key: 'rate', unit: 'Hz' }], 120);
    expect(params.delayMs).toBe(500);
    expect(params.rate).toBe(2); // no companion: untouched
    resolveTempoParams(params, [{ key: 'delayMs', unit: 'ms', min: 0, max: 400 }], 60);
    expect(params.delayMs).toBe(400); // clamped
    expect(hasTempoParams({ a: 1 })).toBe(false);
  });
});

describe('through the engine paths', () => {
  it('a modifier’s Hz rate in beats follows the tempo (Strobe: one flash per beat)', () => {
    const model = { pixelCount: 1 } as unknown as PixelModel;
    const lit = (timeMs: number, bpm: number) => {
      const fb = new Framebuffer(1);
      fb.set(0, 1, 1, 1, 1);
      applyModifierChain([{ modifierId: 'strobe', params: { rate: 8, [tempoKey('rate')]: 1, duty: 0.5 } }], [], fb, { start: 0, end: 1 }, model, timeMs, 16, { phase: 0, timeMs, bpm });
      return fb.rgba[3]! > 0;
    };
    expect([lit(100, 120), lit(300, 120), lit(600, 120)]).toEqual([true, false, true]); // 500ms cycles
    expect(lit(300, 60)).toBe(true); // a 1000ms cycle at 60 bpm: still in its on half
  });

  it('a generator’s ms param in beats is resolved each frame at the live tempo', () => {
    const v = { liveParams: {}, params: { lifeMs: 800, [tempoKey('lifeMs')]: 2 }, specs: [{ key: 'lifeMs', unit: 'ms', min: 0, max: 10000 }], modulations: undefined } as unknown as Voice;
    expect(applyEffectiveParams(v, 0, 120).lifeMs).toBe(1000);
    expect(applyEffectiveParams(v, 0, 60).lifeMs).toBe(2000);
  });
});
