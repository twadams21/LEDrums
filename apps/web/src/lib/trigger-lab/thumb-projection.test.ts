// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getThumbProjection, representativeAgeMs, THUMB_COLS, THUMB_ROWS } from './thumb-projection';
import { THUMB_LOOP_MS } from './effect-thumb-render';
import { listEffects } from '@ledrums/core';

const N = THUMB_COLS * THUMB_ROWS;

describe('getThumbProjection', () => {
  it('projects all 104 thumb pixels inside the canvas at every thumb size', () => {
    // gallery / inspector / clip-settings at dpr 1 and 2
    for (const [w, h] of [
      [170, 92],
      [340, 184],
      [72, 40],
      [144, 80],
      [84, 46],
    ] as const) {
      for (const mini of [false, true]) {
        const proj = getThumbProjection(w, h, mini);
        for (const table of [proj.main, ...(proj.mini ? [proj.mini] : [])]) {
          expect(table.x.length).toBe(N);
          for (let i = 0; i < N; i++) {
            expect(table.x[i]!).toBeGreaterThanOrEqual(0);
            expect(table.x[i]!).toBeLessThanOrEqual(w);
            expect(table.y[i]!).toBeGreaterThanOrEqual(0);
            expect(table.y[i]!).toBeLessThanOrEqual(h);
            expect(table.r[i]!).toBeGreaterThan(0);
            expect(table.shade[i]!).toBeGreaterThan(0);
            expect(table.shade[i]!).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('is cached — same (w, h, mini) returns the same object', () => {
    expect(getThumbProjection(170, 92, false)).toBe(getThumbProjection(170, 92, false));
    expect(getThumbProjection(170, 92, true)).not.toBe(getThumbProjection(170, 92, false));
  });

  it('mini table exists only when requested, is smaller and dimmer, and sits behind-left', () => {
    const proj = getThumbProjection(340, 184, true);
    expect(getThumbProjection(340, 184, false).mini).toBeNull();
    expect(proj.mini).not.toBeNull();
    const maxR = (t: Float32Array) => Math.max(...t);
    expect(maxR(proj.mini!.r)).toBeLessThan(maxR(proj.main.r));
    expect(maxR(proj.mini!.shade)).toBeLessThan(maxR(proj.main.shade));
    const avgX = (t: Float32Array) => t.reduce((s, v) => s + v, 0) / t.length;
    expect(avgX(proj.mini!.x)).toBeLessThan(avgX(proj.main.x));
  });

  it('stacks hoops vertically (¾ camera): higher hoop index → higher on screen', () => {
    const { main } = getThumbProjection(170, 92, false);
    // pixel 0 (hoop 0, angle 0) vs same column on the top hoop
    const bottom = main.y[0]!;
    const top = main.y[(THUMB_ROWS - 1) * THUMB_COLS]!;
    expect(top).toBeLessThan(bottom);
  });

  it('uses four physical hoop rows for the thumbnail model', () => {
    expect(THUMB_ROWS).toBe(4);
    expect(N).toBe(104);
  });

  it('depth-shades the far side of the drum dimmer than the front', () => {
    const { main } = getThumbProjection(170, 92, false);
    // Front of the drum = angle 90° (col 26/4 = 6.5 → col 6/7); back = angle 270° (col 19/20).
    const front = main.shade[7]!;
    const back = main.shade[20]!;
    expect(front).toBeGreaterThan(back);
  });
});

describe('representativeAgeMs', () => {
  it('is 35% of lifeMs / decayMs when the effect declares one', () => {
    expect(representativeAgeMs([{ key: 'lifeMs', default: 1600 }], {}, THUMB_LOOP_MS)).toBeCloseTo(560);
    expect(representativeAgeMs([{ key: 'decayMs', default: 1000 }], {}, THUMB_LOOP_MS)).toBeCloseTo(350);
  });

  it('prefers the clip param override over the spec default', () => {
    expect(representativeAgeMs([{ key: 'decayMs', default: 1000 }], { decayMs: 2000 }, THUMB_LOOP_MS)).toBeCloseTo(700);
  });

  it('converts lifeBeats at the fixed 120bpm transport (500ms/beat)', () => {
    expect(representativeAgeMs([{ key: 'lifeBeats', default: 4 }], {}, THUMB_LOOP_MS)).toBeCloseTo(700);
  });

  it('falls back to 35% of the loop and clamps into [50, loop]', () => {
    expect(representativeAgeMs(undefined, {}, THUMB_LOOP_MS)).toBeCloseTo(560);
    expect(representativeAgeMs([], {}, THUMB_LOOP_MS)).toBeCloseTo(560);
    expect(representativeAgeMs([{ key: 'lifeMs', default: 60000 }], {}, THUMB_LOOP_MS)).toBe(THUMB_LOOP_MS);
    expect(representativeAgeMs([{ key: 'lifeMs', default: 1 }], {}, THUMB_LOOP_MS)).toBe(50);
  });

  it('yields a positive, in-loop representative age for every registered effect', () => {
    for (const gen of listEffects()) {
      const age = representativeAgeMs(gen.paramSpec, {}, THUMB_LOOP_MS);
      expect(age, gen.id).toBeGreaterThanOrEqual(50);
      expect(age, gen.id).toBeLessThanOrEqual(THUMB_LOOP_MS);
    }
  });
});
