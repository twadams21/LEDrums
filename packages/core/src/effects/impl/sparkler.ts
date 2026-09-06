import { clamp01, lerp } from '../../math';
import { pnum, type EffectGenerator } from '../types';
import { EXP_TAIL_FACTOR, VISIBLE_CUTOFF } from '../visibility';
import { createFireEffectState, updateFireEnergy, type FireEffectState } from '../fire-state';
import { hash01, ordered01 } from '../hash';

const SPARK_OFFSET_SALT = 0x5bf03635;
const EMBER_SALT = 0x1b873593;

/** Write HSV directly to the framebuffer path without creating an RGB object per pixel. */
function maxHsv(fb: { max: (id: number, r: number, g: number, b: number, a?: number) => void }, id: number, h: number, s: number, v: number): void {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  fb.max(id, r + m, g + m, b + m, 1);
}

/**
 * Sparkler: a struck drum burns like a sparkler, with scattered white-hot sparks over a
 * half-waved ember bed. Sparks are sampled from pixel identity, the voice seed, and time
 * buckets, so the renderer stays pure while every trigger gets its own repeatable pattern.
 */
export const sparkler: EffectGenerator<FireEffectState> = {
  id: 'sparkler',
  name: 'Sparkler',
  category: 'trigger',
  voiceLife: { key: 'decayMs', unit: 'ms', factor: EXP_TAIL_FACTOR },
  paramSpec: [
    { key: 'decayMs', label: 'Burn', type: 'number', default: 900, min: 100, max: 8000, unit: 'ms' },
    { key: 'density', label: 'Sparks', type: 'number', default: 0.35, min: 0.01, max: 1, step: 0.01 },
    { key: 'sparkMs', label: 'Spark Life', type: 'number', default: 90, min: 10, max: 600, unit: 'ms' },
    { key: 'crackle', label: 'Crackle', type: 'number', default: 0.7, min: 0, max: 1, step: 0.01 },
    { key: 'random', label: 'Random', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'core', label: 'Core Glow', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 42, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState: createFireEffectState,
  render(ctx, params, fb, state) {
    const burnMs = Math.max(1, pnum(params, 'decayMs', 900));
    const density = clamp01(pnum(params, 'density', 0.35));
    const sparkMs = Math.max(1, pnum(params, 'sparkMs', 90));
    const crackle = clamp01(pnum(params, 'crackle', 0.7));
    const random = clamp01(pnum(params, 'random', 1));
    const core = clamp01(pnum(params, 'core', 0.25));
    const hue = pnum(params, 'hue', 42);
    const saturation = clamp01(pnum(params, 'saturation', 1));
    const brightness = clamp01(pnum(params, 'brightness', 1));
    if (!updateFireEnergy(ctx, state, burnMs)) return;

    // Two half-life buckets overlap to keep the spark field continuous at bucket boundaries.
    const bucketMs = sparkMs * 0.5;
    const nowBucket = Math.floor(ctx.timeMs / bucketMs);
    const phase = ctx.timeMs / bucketMs - nowBucket;
    const emberBucket = Math.floor(nowBucket / 8);
    for (let pixelIndex = 0; pixelIndex < ctx.model.pixels.length; pixelIndex += 1) {
      const pixel = ctx.model.pixels[pixelIndex]!;
      const drumIndex = state.drumIndexById.get(pixel.drumId);
      if (drumIndex === undefined) continue;
      const burn = state.energyByDrum[drumIndex]!;
      if (burn < VISIBLE_CUTOFF) continue;

      let spark = 0;
      for (let back = 0; back < 2; back++) {
        const bucket = nowBucket - back;
        const ordered = ordered01(pixel.id, bucket, state.seed);
        const scattered = hash01(pixel.id, bucket, state.seed);
        const pick = lerp(ordered, scattered, random);
        if (pick > density * burn) continue;
        const offset = crackle * hash01(pixel.id ^ SPARK_OFFSET_SALT, bucket, state.seed ^ SPARK_OFFSET_SALT);
        const age = back + phase - offset;
        if (age < 0 || age >= 1) continue;
        spark = Math.max(spark, 1 - age);
      }

      // A positive half-wave forms the ember bed; the second factor keeps real dark gaps.
      const emberWave = Math.max(0, Math.sin(
        pixel.id * 0.37 + pixel.hoopIndex * 1.7 + emberBucket * 0.13
          + hash01(pixel.id, 0, state.seed ^ EMBER_SALT) * Math.PI * 2,
      ));
      const emberGrain = Math.max(0, hash01(pixel.id, emberBucket, state.seed ^ EMBER_SALT) * 2 - 1);
      const ember = emberWave * emberGrain;
      // Burn is applied exactly once here. The core bed is normalized shape, not burn*shape,
      // so it cannot accidentally become burn-squared while the spark probability thins.
      const shape = Math.max(spark, core * ember);
      const level = clamp01(shape * burn * brightness);
      if (level < VISIBLE_CUTOFF) continue;

      // Fresh sparks are white-hot; spent embers cool from the authored yellow toward orange.
      const heat = clamp01(spark);
      const sparkHue = lerp(hue - 15, hue, heat);
      const sparkSaturation = lerp(0.96, 0.12, heat) * saturation;
      maxHsv(fb, pixel.id, sparkHue, sparkSaturation, level);
    }
  },
};
