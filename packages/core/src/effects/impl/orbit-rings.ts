import { hsvToRgb } from '../../color/color';
import { clamp01 } from '../../math';
import { pnum, type EffectGenerator } from '../types';

/**
 * Orbit Rings: a horizontal ring plane orbits up and down through the kit. Pixels
 * whose world height (z) falls within `width` mm of the moving plane light up, hue
 * driven by their angle around the hoop — a glowing band that sweeps the whole rig.
 *
 * Voice timebase (S26): the plane height reads `ctx.timeMs` (hit-relative via the bridge),
 * so the sweep starts at the kit centre (sin 0) on the hit and restarts on retrigger.
 * No body change — the bridge swaps the clock.
 */
export const orbitRings: EffectGenerator = {
  id: 'orbit-rings',
  name: 'Orbit Rings',
  category: 'wash',
  timebase: 'voice',
  paramSpec: [
    { key: 'amp', label: 'Amplitude', type: 'number', default: 1, min: 0, max: 2, step: 0.05 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.2, min: 0, max: 10, step: 0.05, unit: 'rad/s' },
    { key: 'width', label: 'Width', type: 'number', default: 120, min: 5, max: 800, unit: 'mm' },
    { key: 'hue', label: 'Hue', type: 'number', default: 160, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const amp = pnum(params, 'amp', 1);
    const speed = pnum(params, 'speed', 1.2);
    const width = Math.max(1, pnum(params, 'width', 120));
    const hue = pnum(params, 'hue', 160);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);

    const center = ctx.model.bounds.center;
    // Half the kit's vertical extent so amp=1 sweeps top-to-bottom.
    const halfSpan = Math.max(1, (ctx.model.bounds.max.z - ctx.model.bounds.min.z) / 2);
    const t = ctx.timeMs / 1000;
    const planeZ = center.z + amp * halfSpan * Math.sin(t * speed);

    for (const p of ctx.model.pixels) {
      const band = Math.abs(p.world.z - planeZ);
      if (band > width) continue;
      const falloff = 1 - band / width;
      const v = clamp01(bri * falloff);
      if (v < 0.004) continue;
      const pixHue = hue + p.angleDeg;
      const rgb = hsvToRgb(pixHue, sat, v);
      fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
