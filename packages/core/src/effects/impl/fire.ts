import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../field';

/** Deterministic hash → [0,1) from two integer coords. Pure, no RNG state. */
function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Bilinearly-interpolated value noise over a continuous (x,y). */
function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // smoothstep for a softer, flame-like field
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0);
  const n10 = hash2(x0 + 1, y0);
  const n01 = hash2(x0, y0 + 1);
  const n11 = hash2(x0 + 1, y0 + 1);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

/** Map a heat value [0,1] to a black→red→orange→yellow→white ramp. */
function heatColor(heat: number, hueBase: number, bri: number): readonly [number, number, number] {
  const h = clamp01(heat);
  // Hue climbs from base (deep orange/red) toward yellow; sat drops near white-hot.
  const hue = hueBase + h * 50;
  const sat = clamp01(1 - Math.max(0, h - 0.75) * 4); // wash out to white at the top
  const val = bri * clamp01(h * 1.4); // dark at low heat
  const c = hsvToRgb(hue, sat, val);
  return [c.r, c.g, c.b];
}

/**
 * Flames rising up each drum's hoops. Heat is value-noise scrolling downward
 * (so the pattern appears to rise), boosted near the base (low v) and faded as
 * it climbs, giving more fire at the bottom and licks of flame up top.
 */
export const fire: EffectGenerator = {
  id: 'fire',
  name: 'Fire',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.5, min: 0, max: 5, step: 0.01 },
    { key: 'scale', label: 'Scale', type: 'number', default: 6, min: 1, max: 24, step: 0.5 },
    { key: 'hue', label: 'Hue Base', type: 'number', default: 12, min: 0, max: 60, unit: '°' },
    { key: 'intensity', label: 'Intensity', type: 'number', default: 1, min: 0.2, max: 2, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const sp = pnum(params, 'speed', 1.5);
    const sc = pnum(params, 'scale', 6);
    const hue = pnum(params, 'hue', 12);
    const intensity = pnum(params, 'intensity', 1);

    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      // Two octaves of value noise; the field scrolls in -v as time advances → rising.
      const scroll = v * sc - t * sp * 4;
      const n1 = valueNoise(u * sc, scroll);
      const n2 = valueNoise(u * sc * 2.3 + 11.7, scroll * 2.1 - 5.3);
      let heat = n1 * 0.65 + n2 * 0.35;
      // More fuel near the base, dying off toward the top.
      const fade = clamp01(1 - v * 0.95);
      heat = clamp01(heat * intensity * (0.35 + 0.65 * fade) - (1 - fade) * 0.15);
      if (heat <= 0.02) return null; // leave cold pixels dark
      return heatColor(heat, hue, bri);
    });
  },
};
