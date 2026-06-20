import { hsvToRgb } from '../../color/color';
import { clamp01, DEG2RAD } from '../../math';
import { pnum, type EffectGenerator } from '../types';

/**
 * Helix: a double-helix band sweeps vertically through the whole kit. Each pixel's
 * phase combines its world height (z), its angle around the hoop, and time — so the
 * lit band spirals as it climbs. Two strands (offset by π) make it a double helix.
 * Hue follows the phase for a flowing rainbow ribbon.
 */
export const helix: EffectGenerator = {
  id: 'helix',
  name: 'Helix',
  category: 'wash',
  paramSpec: [
    { key: 'kz', label: 'Vertical Density', type: 'number', default: 0.012, min: 0.0005, max: 0.1, step: 0.0005, unit: '/mm' },
    { key: 'ka', label: 'Turns', type: 'number', default: 2, min: 0.25, max: 12, step: 0.25 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.5, min: 0, max: 12, step: 0.05, unit: 'rad/s' },
    { key: 'hue', label: 'Hue', type: 'number', default: 280, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const kz = pnum(params, 'kz', 0.012);
    const ka = pnum(params, 'ka', 2);
    const speed = pnum(params, 'speed', 1.5);
    const hue = pnum(params, 'hue', 280);
    const bri = pnum(params, 'brightness', 1);

    const t = ctx.timeMs / 1000;
    // Convert "turns" to radians applied to the pixel angle.
    const angleK = ka * DEG2RAD;

    for (const p of ctx.model.pixels) {
      const phase = p.world.z * kz + p.angleDeg * angleK + t * speed;
      // Two strands offset by π → double helix. Take the brighter strand.
      const s1 = Math.sin(phase);
      const s2 = Math.sin(phase + Math.PI);
      const lit = Math.max(s1, s2); // in [-1, 1]; near 1 where a strand passes.
      // Sharpen the band so only the crest lights.
      const band = Math.pow(clamp01(lit), 3);
      const v = clamp01(bri * band);
      if (v < 0.004) continue;
      const pixHue = hue + (phase * 30) / Math.PI;
      const rgb = hsvToRgb(pixHue, 1, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
