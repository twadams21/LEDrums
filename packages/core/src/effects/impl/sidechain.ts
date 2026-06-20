import { hsvToRgb } from '../../color/color';
import { clamp01 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

export interface SidechainState {
  /** Current gain multiplier on the fill, 0 (fully ducked) .. 1 (recovered). */
  gain: number;
  lastSeq: number;
}

/**
 * Sidechain: a steady full-kit fill that DUCKS (darkens) instantly on every new
 * trigger and recovers over recoverMs — the classic pump used to "duck the base
 * layer so an effect on top reads louder". Stateful, deterministic (no RNG).
 */
export const sidechain: EffectGenerator<SidechainState> = {
  id: 'sidechain',
  name: 'Sidechain Pump',
  category: 'utility',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
    { key: 'duckDepth', label: 'Duck Depth', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'recoverMs', label: 'Recover', type: 'number', default: 350, min: 20, max: 4000, unit: 'ms' },
  ],
  createState(_model: PixelModel): SidechainState {
    return { gain: 1, lastSeq: 0 };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 210);
    const sat = pnum(params, 'saturation', 0.8);
    const bri = pnum(params, 'brightness', 0.8);
    const duckDepth = clamp01(pnum(params, 'duckDepth', 0.85));
    const recover = Math.max(1, pnum(params, 'recoverMs', 350));

    // Recover toward full gain over recoverMs (linear ramp scaled by dt).
    state.gain = clamp01(state.gain + ctx.dt / recover);

    // Any newly-arrived trigger ducks the gain instantly to the floor.
    const floor = 1 - duckDepth;
    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      // Velocity scales how hard we duck (a soft hit ducks less).
      const target = clamp01(1 - duckDepth * trig.velocity);
      if (target < state.gain) state.gain = target;
    }
    // Guard against gain dipping below the configured floor on full-velocity hits.
    if (state.gain < floor) state.gain = floor;

    const v = clamp01(bri * state.gain);
    if (v < 0.004) return;
    const rgb = hsvToRgb(hue, sat, v);
    for (const p of ctx.model.pixels) fb.set(p.id, rgb.r, rgb.g, rgb.b, v);
  },
};
