import { clamp01 } from '../../math';
import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../field';
import { pnum, type EffectGenerator } from '../types';

/** Smooth glowing pulse centered on a grid line: 1 at the line, falling off either side. */
function linePulse(frac: number, width: number): number {
  // Distance to the nearest line (lines at 0 and 1 of the cell are the same edge).
  const d = Math.min(frac, 1 - frac);
  return clamp01(1 - d / width);
}

/**
 * Glowing neon grid wrapped around each drum (cylindrical): vertical + horizontal
 * lines glow, the whole grid breathing with a time pulse.
 */
export const gridGlow: EffectGenerator = {
  id: 'grid-glow',
  name: 'Grid Glow',
  category: 'texture',
  paramSpec: [
    { key: 'cols', label: 'Columns', type: 'number', default: 6, min: 1, max: 24, step: 1 },
    { key: 'rows', label: 'Rows', type: 'number', default: 4, min: 1, max: 24, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 5, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 320, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const cols = Math.max(1, Math.round(pnum(params, 'cols', 6)));
    const rows = Math.max(1, Math.round(pnum(params, 'rows', 4)));
    const speed = pnum(params, 'speed', 1);
    const hue = pnum(params, 'hue', 320);
    const bri = pnum(params, 'brightness', 1);
    const width = 0.18; // glow half-width as a fraction of a cell
    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const fu = u * cols - Math.floor(u * cols);
      const fv = v * rows - Math.floor(v * rows);
      const gx = linePulse(fu, width);
      const gy = linePulse(fv, width);
      const grid = Math.max(gx, gy);
      const pulse = 0.6 + 0.4 * Math.sin(t * speed * 2); // breathing brightness
      const b = clamp01(grid * pulse);
      if (b <= 0) return [0, 0, 0];
      const c = hsvToRgb(hue + grid * 30, 1, bri * b);
      return [c.r, c.g, c.b];
    });
  },
};
