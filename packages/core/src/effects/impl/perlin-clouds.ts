import { clamp01, fbm } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../../canvas/sampler';
import { pnum, type EffectGenerator } from '../types';

/** This generator's fractal density: 3 octaves of the shared value noise. */
const OCTAVES = 3;

/**
 * Drifting value-noise clouds wrapped around each drum (cylindrical). The noise field
 * scrolls horizontally over time; grayscale density tints a hue band.
 */
export const perlinClouds: EffectGenerator = {
  id: 'perlin-clouds',
  name: 'Perlin Clouds',
  category: 'texture',
  paramSpec: [
    { key: 'scale', label: 'Scale', type: 'number', default: 4, min: 1, max: 16, step: 0.1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.6, min: 0, max: 5, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const scale = pnum(params, 'scale', 4);
    const speed = pnum(params, 'speed', 0.6);
    const hue = pnum(params, 'hue', 210);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const n = fbm(u * scale + t * speed, v * scale, OCTAVES);
      const dens = clamp01(n * n * 1.6); // sharpen so clouds read as puffs
      const c = hsvToRgb(hue + dens * 40, sat * (0.35 + 0.45 * (1 - dens)), bri * dens);
      return [c.r, c.g, c.b];
    });
  },
};
