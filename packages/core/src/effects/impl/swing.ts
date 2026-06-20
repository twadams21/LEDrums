import { hsvToRgb } from '../../color/color';
import { clamp01 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

export interface SwingState {
  /** Per-drum accumulated energy, indexed by drumId. */
  energy: Map<string, number>;
  lastSeq: number;
}

/**
 * Swing: each hit "tops up" a per-drum energy that decays every frame — time the
 * hits like pushing a swing and the light keeps climbing; let it ride and it falls
 * away. Energy maps directly to drum brightness. Stateful, no RNG (deterministic).
 */
export const swing: EffectGenerator<SwingState> = {
  id: 'swing',
  name: 'Swing',
  category: 'trigger',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 300, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'gain', label: 'Gain / Hit', type: 'number', default: 0.5, min: 0.01, max: 1, step: 0.01 },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 900, min: 50, max: 8000, unit: 'ms' },
  ],
  createState(_model: PixelModel): SwingState {
    return { energy: new Map(), lastSeq: 0 };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 300);
    const bri = pnum(params, 'brightness', 1);
    const gain = pnum(params, 'gain', 0.5);
    const decay = Math.max(1, pnum(params, 'decayMs', 900));

    // Decay all existing energy each frame.
    const factor = Math.exp(-ctx.dt / decay);
    for (const [id, e] of state.energy) {
      const next = e * factor;
      if (next < 0.004) state.energy.delete(id);
      else state.energy.set(id, next);
    }

    // Each newly-arrived trigger tops up its drum's energy (clamped to 1).
    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      if (!ctx.model.drumById.has(trig.drumId)) continue;
      const prev = state.energy.get(trig.drumId) ?? 0;
      state.energy.set(trig.drumId, clamp01(prev + trig.velocity * gain));
    }

    if (state.energy.size === 0) return;
    for (const p of ctx.model.pixels) {
      const e = state.energy.get(p.drumId);
      if (e === undefined || e < 0.004) continue;
      const v = clamp01(bri * e);
      const rgb = hsvToRgb(hue, 1, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
