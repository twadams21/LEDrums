import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext, TransportState, Trigger } from '../engine/render-context';
import { defaultParams, type EffectGenerator, type ResolvedParams } from './types';
import type { FireEffectState } from './fire-state';
import { sparkContributionAt, sparkler } from './impl/sparkler';
import { flameFlicker } from './impl/flame-flicker';

function model(drums = 2, hoopCount = 4): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 40, hoopCount, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums: Array.from({ length: drums }, (_, i) => ({
      id: `d${i}`,
      diameterIn: 8,
      hoopSpacingMm: 50,
      origin: { x: i * 600, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

const transport = (timeMs: number): TransportState => ({
  timeMs, beat: timeMs / 500, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true,
});

const hit = (drumId: string, ageMs: number, velocity = 1, seq = 1): Trigger => ({
  seq, drumId, note: 38, velocity, timeMs: 0, ageMs,
});

type FireEffect = EffectGenerator<FireEffectState>;

function frame(effect: FireEffect, m: PixelModel, timeMs: number, triggers: Trigger[], over: ResolvedParams = {}, seed = 123): Framebuffer {
  const fb = new Framebuffer(m.pixelCount);
  const params = { ...defaultParams(effect.paramSpec), ...over };
  if (!effect.createState) throw new Error(`Expected ${effect.id} to own fire state`);
  const state = effect.createState(m, seed);
  effect.render({ model: m, timeMs, dt: 5, transport: transport(timeMs), triggers }, params, fb, state);
  return fb;
}

function brightness(fb: Framebuffer, id: number): number {
  const j = id * 4;
  return Math.max(fb.rgba[j]!, fb.rgba[j + 1]!, fb.rgba[j + 2]!);
}

function litIds(fb: Framebuffer, threshold = 0): number[] {
  const ids: number[] = [];
  for (let id = 0; id < fb.pixelCount; id++) if (brightness(fb, id) > threshold) ids.push(id);
  return ids;
}

function total(fb: Framebuffer): number {
  let sum = 0;
  for (let i = 0; i < fb.rgba.length; i++) sum += fb.rgba[i]!;
  return sum;
}

function allFiniteInRange(fb: Framebuffer): boolean {
  for (let i = 0; i < fb.rgba.length; i++) {
    const value = fb.rgba[i]!;
    if (!Number.isFinite(value) || value < 0 || value > 1) return false;
  }
  return true;
}

describe.each([
  ['sparkler', sparkler],
  ['flame-flicker', flameFlicker],
] as const)('%s', (_name, effect) => {
  it('renders only the struck drum and stays dark without a hit', () => {
    const m = model();
    const fb = frame(effect, m, 40, [hit('d0', 20)]);
    const other = m.drumById.get('d1')!;
    expect(litIds(fb)).not.toHaveLength(0);
    for (let id = other.pixelStart; id < other.pixelStart + other.pixelCount; id++) {
      expect(brightness(fb, id)).toBe(0);
    }
    expect(litIds(frame(effect, m, 40, []))).toHaveLength(0);
  });

  it('is deterministic for the same seeded trigger', () => {
    const m = model();
    expect(Array.from(frame(effect, m, 137, [hit('d0', 55)], {}, 77).rgba))
      .toEqual(Array.from(frame(effect, m, 137, [hit('d0', 55)], {}, 77).rgba));
  });

  it('thins and dims as the burn spends', () => {
    const m = model();
    const fresh = frame(effect, m, 60, [hit('d0', 30)], { density: 1, core: 0 });
    const spent = frame(effect, m, 1500, [hit('d0', 1450)], { density: 1, core: 0 });
    expect(total(spent)).toBeLessThan(total(fresh));
    if (effect.id === 'sparkler') expect(litIds(spent, 0.3).length).toBeLessThan(litIds(fresh, 0.3).length);
  });

  it('keeps every channel finite and clamped at parameter endpoints', () => {
    const m = model();
    const low: ResolvedParams = {};
    const high: ResolvedParams = {};
    for (const spec of effect.paramSpec) {
      if (spec.type === 'number') {
        low[spec.key] = spec.min ?? 0;
        high[spec.key] = spec.max ?? 1;
      }
    }
    for (const params of [low, high]) {
      for (const timeMs of [0, 89, 90, 500, 4000]) {
        expect(allFiniteInRange(frame(effect, m, timeMs, [hit('d0', Math.max(0, timeMs - 20))], params))).toBe(true);
      }
    }
  });
});

describe('Sparkler spatial and temporal behavior', () => {
  const m = model();
  const drum = m.drumById.get('d0')!;

  it('has genuine dark gaps over its ember bed', () => {
    const fb = frame(sparkler, m, 60, [hit('d0', 25)]);
    const levels = [];
    for (let id = drum.pixelStart; id < drum.pixelStart + drum.pixelCount; id++) levels.push(brightness(fb, id));
    expect(levels.some((value) => value > 0.02)).toBe(true);
    expect(levels.some((value) => value === 0)).toBe(true);
  });

  it('keeps a previous spark bucket alive across its boundary', () => {
    const before = frame(sparkler, m, 89, [hit('d0', 20)], { density: 0.35, core: 0, crackle: 1 });
    const after = frame(sparkler, m, 90, [hit('d0', 20)], { density: 0.35, core: 0, crackle: 1 });
    expect(litIds(before, 0.01).length).toBeGreaterThan(0);
    expect(litIds(after, 0.01).length).toBeGreaterThan(0);
  });

  it('uses the seed in Sparkler’s Random=1 spatial decisions', () => {
    const a = frame(sparkler, m, 60, [hit('d0', 25)], { random: 1, crackle: 0, core: 0 }, 1);
    const b = frame(sparkler, m, 60, [hit('d0', 25)], { random: 1, crackle: 0, core: 0 }, 2);
    expect(Array.from(a.rgba)).not.toEqual(Array.from(b.rgba));
  });

  it('changes placement without changing expected density across Random values', () => {
    const large = model(24, 4);
    const density = 0.27;
    const randomValues = [0, 0.2, 0.5, 0.8, 1];
    const selected = (random: number, seed: number): Set<number> => new Set(
      large.pixels
        .filter((pixel) => sparkContributionAt(20, 45, 0, pixel.id, 0, seed, density, random) > 0)
        .map((pixel) => pixel.id),
    );

    const sets = randomValues.map((random) => selected(random, 101));
    const ratios = sets.map((set) => set.size / large.pixels.length);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(density, 1);
    expect(sets[0]).not.toEqual(sets[sets.length - 1]);
    expect([...sets[0]!].filter((id) => sets[sets.length - 1]!.has(id)).length).toBeLessThan(sets[0]!.size * 0.9);
    // Repeat the statistical check with different trigger seeds; placement changes, density does not.
    for (const seed of [1, 2, 3, 4, 5]) {
      const set = selected(0.5, seed);
      expect(set.size / large.pixels.length).toBeCloseTo(density, 1);
    }
  });

  it('keeps each spark identity alive for exactly Spark Life and blends bucket boundaries', () => {
    const sparkMs = 90;
    expect(sparkContributionAt(89, sparkMs, 0, 11, 0, 7, 1, 0)).toBeGreaterThan(0);
    expect(sparkContributionAt(90, sparkMs, 0, 11, 0, 7, 1, 0)).toBe(0);

    const before = frame(sparkler, m, 44, [hit('d0', 44)], { density: 1, core: 0, crackle: 0, sparkMs });
    const boundary = frame(sparkler, m, 45, [hit('d0', 45)], { density: 1, core: 0, crackle: 0, sparkMs });
    const after = frame(sparkler, m, 46, [hit('d0', 46)], { density: 1, core: 0, crackle: 0, sparkMs });
    expect(total(boundary)).toBeGreaterThan(0);
    const maxChannelDelta = (a: Framebuffer, b: Framebuffer): number =>
      Math.max(...a.rgba.map((value, index) => Math.abs(value - b.rgba[index]!)));
    expect(maxChannelDelta(boundary, before)).toBeLessThan(0.05);
    expect(maxChannelDelta(after, boundary)).toBeLessThan(0.05);
  });

  it('keeps sparks inside the warm colour-temperature range', () => {
    const fresh = frame(sparkler, m, 100, [hit('d0', 0)], { density: 1, core: 0, crackle: 0, sparkMs: 45 });
    const cooling = frame(sparkler, m, 130, [hit('d0', 0)], { density: 1, core: 0, crackle: 0, sparkMs: 45 });
    expect(total(fresh)).toBeGreaterThan(total(cooling));
    for (const fb of [fresh, cooling]) {
      for (const id of litIds(fb)) {
        const j = id * 4;
        expect(fb.rgba[j]!).toBeGreaterThanOrEqual(fb.rgba[j + 1]!);
        expect(fb.rgba[j + 1]!).toBeGreaterThanOrEqual(fb.rgba[j + 2]!);
      }
    }
  });
});

describe('Flame Flicker behavior', () => {
  const m = model();
  const drum = m.drumById.get('d0')!;

  it('is one coherent body at Spread=0 and varies at Spread=1', () => {
    const whole = frame(flameFlicker, m, 60, [hit('d0', 25)], { spread: 0, random: 0 });
    const varied = frame(flameFlicker, m, 60, [hit('d0', 25)], { spread: 1, random: 0 });
    const wholeLevels: number[] = [];
    const variedLevels: number[] = [];
    for (let id = drum.pixelStart; id < drum.pixelStart + drum.pixelCount; id++) {
      wholeLevels.push(brightness(whole, id));
      variedLevels.push(brightness(varied, id));
    }
    expect(Math.max(...wholeLevels) - Math.min(...wholeLevels)).toBeLessThan(0.0001);
    expect(Math.max(...variedLevels) - Math.min(...variedLevels)).toBeGreaterThan(0.01);
  });

  it.each([0, 0.01, 0.5, 1])('changes coherently as Spread moves to per-pixel at %s', (spread) => {
    const fb = frame(flameFlicker, m, 60, [hit('d0', 25)], { spread, random: 0 });
    const levels = Array.from({ length: drum.pixelCount }, (_, i) => brightness(fb, drum.pixelStart + i));
    const variation = Math.max(...levels) - Math.min(...levels);
    if (spread === 0) expect(variation).toBeLessThan(0.0001);
    if (spread === 0.01) expect(variation).toBeLessThan(0.01);
    if (spread === 0.5) expect(variation).toBeGreaterThan(variationAtSpread(m, 0.01));
    if (spread === 1) expect(variation).toBeGreaterThan(0.01);
  });

  it('uses fine sampling to show Random=1 stepping is less steady than Random=0 waves', () => {
    const biggestJump = (random: number): number => {
      let previous = brightness(frame(flameFlicker, m, 0, [hit('d0', 0)], { random, spread: 0, depth: 1, decayMs: 100000 }), drum.pixelStart);
      let largest = 0;
      for (let timeMs = 5; timeMs <= 1000; timeMs += 5) {
        const current = brightness(frame(flameFlicker, m, timeMs, [hit('d0', 0)], { random, spread: 0, depth: 1, decayMs: 100000 }), drum.pixelStart);
        largest = Math.max(largest, Math.abs(current - previous));
        previous = current;
      }
      return largest;
    };
    expect(biggestJump(0) * 2).toBeLessThan(biggestJump(1));
  });

  it('keeps Random from smuggling in pixel variation when Spread=0', () => {
    const fb = frame(flameFlicker, m, 60, [hit('d0', 25)], { random: 1, spread: 0 });
    const levels: number[] = [];
    for (let id = drum.pixelStart; id < drum.pixelStart + drum.pixelCount; id++) levels.push(brightness(fb, id));
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(0.0001);
  });
});

describe('fire pair declarations', () => {
  it('declares the exponential burn life it visibly needs', () => {
    expect(sparkler.voiceLife).toEqual({ key: 'decayMs', unit: 'ms', factor: expect.any(Number) });
    expect(flameFlicker.voiceLife).toEqual({ key: 'decayMs', unit: 'ms', factor: expect.any(Number) });
    expect(sparkler.timebase).toBe('voice');
    expect(flameFlicker.timebase).toBe('voice');
  });
});

function variationAtSpread(modelValue: PixelModel, spread: number): number {
  const fb = frame(flameFlicker, modelValue, 60, [hit('d0', 25)], { spread, random: 0 });
  const drumValue = modelValue.drumById.get('d0')!;
  const levels = Array.from({ length: drumValue.pixelCount }, (_, i) => brightness(fb, drumValue.pixelStart + i));
  return Math.max(...levels) - Math.min(...levels);
}
