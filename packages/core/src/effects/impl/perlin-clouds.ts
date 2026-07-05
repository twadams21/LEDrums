import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../../canvas/sampler';
import { pnum, type EffectGenerator } from '../types';

/** Deterministic 2D hash → [0,1] using a closed-form sin scramble (no RNG state). */
function hash2(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth Hermite fade for cleaner interpolation than raw bilinear. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise at (x,y); integer lattice hashed, smoothstep-interpolated. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const ux = fade(fx);
  const uy = fade(fy);
  const top = a + (b - a) * ux;
  const bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

/** 3-octave fractal value noise, normalized to [0,1]. */
function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return clamp01(sum / norm);
}

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
      const n = fbm(u * scale + t * speed, v * scale);
      const dens = clamp01(n * n * 1.6); // sharpen so clouds read as puffs
      const c = hsvToRgb(hue + dens * 40, sat * (0.35 + 0.45 * (1 - dens)), bri * dens);
      return [c.r, c.g, c.b];
    });
  },
};
