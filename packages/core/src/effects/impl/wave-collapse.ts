import { clamp01, distance } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * The collapsing/exploding shell radius (mm) for a hit of the given age. The shell
 * starts at `reach`, collapses inward to the origin (radius 0), then explodes back
 * out to `reach`. One full in-then-out cycle over its travel time. Exported for tests.
 */
export function collapseRadius(ageMs: number, speed: number, reach: number): number {
  // Distance travelled along the in→out path; `speed` is mm/ms.
  const d = ageMs * speed;
  const phase = d % (2 * reach);
  // First half: reach → 0 (collapse). Second half: 0 → reach (explode).
  return phase <= reach ? reach - phase : phase - reach;
}

/**
 * Wave Collapse: on a hit, a shell of light first COLLAPSES inward from the kit's far
 * edge toward the struck drum's effect origin, then EXPLODES back outward. A band of
 * light sits at the current radius and the whole thing fades over `decayMs` — like a
 * radial wash run in reverse and then forward.
 */
export const waveCollapse: EffectGenerator = {
  id: 'wave-collapse',
  name: 'Wave Collapse',
  category: 'wash',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 320, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.2, min: 0.05, max: 6, step: 0.05, unit: 'mm/ms' },
    { key: 'width', label: 'Width', type: 'number', default: 180, min: 10, max: 800, unit: 'mm' },
    { key: 'reach', label: 'Reach', type: 'number', default: 1200, min: 100, max: 4000, unit: 'mm' },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 600, min: 50, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 320);
    const bri = pnum(params, 'brightness', 0.9);
    const speed = pnum(params, 'speed', 1.2);
    const width = Math.max(1, pnum(params, 'width', 180));
    const reach = Math.max(1, pnum(params, 'reach', 1200));
    const decay = Math.max(1, pnum(params, 'decayMs', 600));

    for (const trig of ctx.triggers) {
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      const envelope = trig.velocity * Math.exp(-trig.ageMs / decay);
      if (envelope < 0.004) continue;
      const radius = collapseRadius(trig.ageMs, speed, reach);
      const origin = drum.effectOriginWorld;
      for (const p of ctx.model.pixels) {
        const band = Math.abs(distance(p.world, origin) - radius);
        if (band > width) continue;
        const falloff = 1 - band / width;
        const v = clamp01(envelope * falloff * bri);
        if (v < 0.004) continue;
        const rgb = hsvToRgb(hue, 1, v);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
