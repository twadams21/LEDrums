import { clamp01, lerp } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Velocity Flames: each drum grows a flame from hoop 0 upward whose height tracks
 * that drum's most-recent hit velocity, decaying over time. The flame tip flickers
 * via a per-pixel sine, and the palette runs hot — white/yellow at the base, deep
 * red at the crest. Pure: flame height comes from the live triggers' decayed energy.
 */
export const velocityFlames: EffectGenerator = {
  id: 'velocity-flames',
  name: 'Velocity Flames',
  category: 'trigger',
  paramSpec: [
    { key: 'decayMs', label: 'Decay', type: 'number', default: 700, min: 50, max: 6000, unit: 'ms' },
    { key: 'flicker', label: 'Flicker', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const decay = Math.max(1, pnum(params, 'decayMs', 700));
    const flicker = clamp01(pnum(params, 'flicker', 0.25));
    const bri = clamp01(pnum(params, 'brightness', 1));

    // Per-drum flame height = strongest decayed velocity among that drum's triggers.
    const heightByDrum = new Map<string, number>();
    for (const trig of ctx.triggers) {
      const e = trig.velocity * Math.exp(-trig.ageMs / decay);
      const prev = heightByDrum.get(trig.drumId) ?? 0;
      if (e > prev) heightByDrum.set(trig.drumId, e);
    }
    if (heightByDrum.size === 0) return;

    const t = ctx.timeMs * 0.001;
    for (const p of ctx.model.pixels) {
      const flameHeight = heightByDrum.get(p.drumId);
      if (flameHeight === undefined || flameHeight < 0.004) continue;

      // Flicker the effective height a little, varied per pixel angle/hoop.
      const flick = 1 + flicker * 0.4 * Math.sin(t * 11 + p.angleDeg * 0.15 + p.hoopIndex * 1.3);
      const effHeight = clamp01(flameHeight * flick);
      if (p.normHoop > effHeight) continue;

      // Fraction up the flame body: 0 at base (hot/white), 1 at the tip (red).
      const up = effHeight > 0 ? clamp01(p.normHoop / effHeight) : 0;
      const hue = lerp(55, 0, up); // yellow -> red
      const sat = lerp(0.2, 1, up); // base whiter, tip saturated red
      // Brighter at the base, tapering toward the tip, with a touch of flicker.
      const taper = 1 - 0.5 * up;
      const flickBri = 1 - flicker * 0.3 * (0.5 + 0.5 * Math.sin(t * 17 + p.angleDeg * 0.21));
      const v = clamp01(bri * flameHeight * taper * flickBri);
      if (v < 0.004) continue;
      const rgb = hsvToRgb(hue, sat, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
