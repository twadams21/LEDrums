import { clamp01, lerp } from '../../math';
import { pnum, type EffectGenerator } from '../types';
import { EXP_TAIL_FACTOR, VISIBLE_CUTOFF } from '../visibility';
import { createFireEffectState, updateFireEnergy, type FireEffectState } from '../fire-state';
import { fireRandom01 } from '../fire-random';

const TAU = Math.PI * 2;

function maxWarmHsv(fb: { max: (id: number, r: number, g: number, b: number, a?: number) => void }, id: number, h: number, s: number, v: number): void {
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
  // Alpha is coverage/intensity, not a blanket opaque mask. Mix relies on this when a dim
  // flame is composited over another branch.
  fb.max(id, r + m, g + m, b + m, v);
}

/**
 * Flame Flicker: one warm flame per struck drum. Three incommensurate waves make the smooth
 * motion, Spread moves from one coherent body to per-pixel variation, and Random blends that
 * motion toward a seeded level that steps once per rate period.
 */
export const flameFlicker: EffectGenerator<FireEffectState> = {
  id: 'flame-flicker',
  name: 'Flame Flicker',
  category: 'trigger',
  timebase: 'voice',
  voiceLife: { key: 'decayMs', unit: 'ms', factor: EXP_TAIL_FACTOR },
  paramSpec: [
    { key: 'decayMs', label: 'Decay', type: 'number', default: 800, min: 100, max: 8000, unit: 'ms' },
    { key: 'rateHz', label: 'Rate', type: 'number', default: 9, min: 0.5, max: 40, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
    { key: 'spread', label: 'Spread', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01 },
    { key: 'random', label: 'Random', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 32, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState: createFireEffectState,
  render(ctx, params, fb, state) {
    const decayMs = Math.max(1, pnum(params, 'decayMs', 800));
    const rateHz = Math.max(0.01, pnum(params, 'rateHz', 9));
    const depth = clamp01(pnum(params, 'depth', 0.6));
    const spread = clamp01(pnum(params, 'spread', 0.35));
    const random = clamp01(pnum(params, 'random', 0.5));
    const hue = pnum(params, 'hue', 32);
    const saturation = clamp01(pnum(params, 'saturation', 0.85));
    const brightness = clamp01(pnum(params, 'brightness', 1));
    if (!updateFireEnergy(ctx, state, decayMs)) return;

    const t = ctx.timeMs * 0.001 * rateHz;
    const tick = Math.floor(t);
    const coherentA = Math.sin(t * TAU);
    const coherentB = Math.sin(t * 4.117 + 1.3);
    const coherentC = Math.sin(t * 9.531 + 2.1);
    for (let drumIndex = 0; drumIndex < state.drumStepByDrum.length; drumIndex += 1) {
      state.drumStepByDrum[drumIndex] = fireRandom01(state.seed, drumIndex, tick, 0);
    }
    for (let pixelIndex = 0; pixelIndex < ctx.model.pixels.length; pixelIndex += 1) {
      const pixel = ctx.model.pixels[pixelIndex]!;
      const drumIndex = state.drumIndexByPixel[pixelIndex]!;
      if (drumIndex < 0) continue;
      const energy = state.energyByDrum[drumIndex]!;
      if (energy < VISIBLE_CUTOFF) continue;

      // Spread is an interpolation between two samples of the same field: one value coherent
      // across this drum and one value keyed to this pixel. A small spread therefore remains
      // near the coherent body instead of changing the hash identity wholesale.
      const spatial = (pixel.hoopIndex - 1) * 1.9 + pixel.angleDeg * 0.021;
      const pixelA = Math.sin(t * TAU + spatial);
      const pixelB = Math.sin(t * 4.117 + spatial * 2.7 + 1.3);
      const pixelC = Math.sin(t * 9.531 + spatial * 0.6 + 2.1);
      const waveA = lerp(coherentA, pixelA, spread);
      const waveB = lerp(coherentB, pixelB, spread);
      const waveC = lerp(coherentC, pixelC, spread);
      const smooth = clamp01(0.5 + (waveA * 0.5 + waveB * 0.32 + waveC * 0.18) * 0.5);
      const drumStep = state.drumStepByDrum[drumIndex]!;
      const pixelStep = fireRandom01(state.seed, pixel.id, tick, 1);
      const stepped = lerp(drumStep, pixelStep, spread);
      const flame = clamp01(lerp(smooth, stepped, random));
      // Energy is the only burn multiplier. The depth control changes flame shape, not decay.
      const level = clamp01(energy * lerp(1, flame, depth) * brightness);
      if (level < VISIBLE_CUTOFF) continue;
      const warmSaturation = saturation * lerp(1, 0.55, flame * depth);
      maxWarmHsv(fb, pixel.id, hue, warmSaturation, level);
    }
  },
};
