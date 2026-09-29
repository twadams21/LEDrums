/* Effect chains S02 §4 — the section Master chain as a pure function over a composited frame. */
import { describe, expect, it } from 'vitest';
import { Framebuffer } from '../engine/framebuffer';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { applySectionMaster, createSectionMasterState, resetSectionMaster } from './master';
import { masterChainSchema, type ModifierDevice } from './types';

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  }));
}

/** A frame lit a uniform grey `v` (opaque). */
function litFrame(m: PixelModel, v = 1): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  for (let i = 0; i < m.pixelCount; i++) fb.set(i, v, v, v, 1);
  return fb;
}

const chain = (...devices: unknown[]): ModifierDevice[] => masterChainSchema.parse(devices);

/** Max red channel over the frame. */
const redMax = (fb: Framebuffer): number => {
  let mx = 0;
  for (let i = 0; i < fb.pixelCount; i++) mx = Math.max(mx, fb.rgba[i * 4]!);
  return mx;
};

describe('applySectionMaster', () => {
  it('leaves the frame bit-identical when the master chain is empty or absent', () => {
    const m = model();
    const expected = litFrame(m, 0.7).rgba.slice();
    for (const master of [undefined, chain()]) {
      const fb = litFrame(m, 0.7);
      applySectionMaster(fb, master, createSectionMasterState(), { model: m, timeMs: 100, dt: 10 });
      expect(fb.rgba).toEqual(expected);
    }
  });

  it('levels at brightness 0.5 halves every pixel of the frame', () => {
    const m = model();
    const fb = litFrame(m, 1);
    const master = chain({ uid: 'l', modifierId: 'levels', params: { brightness: 0.5 } });
    applySectionMaster(fb, master, createSectionMasterState(), { model: m, timeMs: 0, dt: 0 });
    for (let i = 0; i < m.pixelCount; i++) {
      expect(fb.rgba[i * 4]).toBeCloseTo(0.5, 6);
      expect(fb.rgba[i * 4 + 1]).toBeCloseTo(0.5, 6);
      expect(fb.rgba[i * 4 + 2]).toBeCloseTo(0.5, 6);
    }
  });

  it('a bypassed master link is identity', () => {
    const m = model();
    const fb = litFrame(m, 1);
    const master = chain({ uid: 'l', modifierId: 'levels', params: { brightness: 0 }, bypass: true });
    applySectionMaster(fb, master, createSectionMasterState(), { model: m, timeMs: 0, dt: 0 });
    expect(redMax(fb)).toBe(1);
  });

  it('runs on a section clock that starts at the first apply and restarts on reset', () => {
    const m = model();
    // 1 Hz, 50 % duty: on for section-ms [0, 500), off for [500, 1000).
    const master = chain({ uid: 's', modifierId: 'strobe', params: { rate: 1, duty: 0.5 } });
    const state = createSectionMasterState();
    const at = (timeMs: number): number => {
      const fb = litFrame(m, 1);
      applySectionMaster(fb, master, state, { model: m, timeMs, dt: 10 });
      return redMax(fb);
    };
    expect(at(10_000)).toBe(1); // section-ms 0 — the engine time is irrelevant
    expect(at(10_200)).toBe(1);
    expect(at(10_600)).toBe(0);
    resetSectionMaster(state);
    expect(at(10_700)).toBe(1); // clock restarted: section-ms 0 again
    expect(at(11_300)).toBe(0);
  });

  it('rebuilds its links when the master chain changes identity', () => {
    const m = model();
    const state = createSectionMasterState();
    const ctx = { model: m, timeMs: 0, dt: 0 };
    const half = litFrame(m, 1);
    applySectionMaster(half, chain({ uid: 'l', modifierId: 'levels', params: { brightness: 0.5 } }), state, ctx);
    expect(redMax(half)).toBeCloseTo(0.5, 6);
    const quarter = litFrame(m, 1);
    applySectionMaster(quarter, chain({ uid: 'l', modifierId: 'levels', params: { brightness: 0.25 } }), state, ctx);
    expect(redMax(quarter)).toBeCloseTo(0.25, 6);
  });
});
