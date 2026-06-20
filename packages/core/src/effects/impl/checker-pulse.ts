import { wrap } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../field';

/**
 * A checkerboard wrapped around each drum that slowly rotates (cells scroll in
 * u over time). "On" cells glow at full brightness; "off" cells pulse in and
 * out with a sine, so the board breathes. Hue cycles slowly across the whole
 * effect.
 */
export const checkerPulse: EffectGenerator = {
  id: 'checker-pulse',
  name: 'Checker Pulse',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'cols', label: 'Columns', type: 'number', default: 6, min: 1, max: 24, step: 1 },
    { key: 'rows', label: 'Rows', type: 'number', default: 4, min: 1, max: 24, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0, max: 6, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 280, min: 0, max: 360, unit: '°' },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const cols = pnum(params, 'cols', 6);
    const rows = pnum(params, 'rows', 4);
    const sp = pnum(params, 'speed', 1);
    const hue = pnum(params, 'hue', 280);

    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const cell = (Math.floor(u * cols + t * sp * 0.5) + Math.floor(v * rows)) % 2;
      const pulse = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * sp * 3));
      const val = bri * (cell !== 0 ? 1 : pulse);
      // Slow global hue cycle, with a small offset between the two cell phases.
      const h = wrap(hue + t * sp * 12 + (cell !== 0 ? 0 : 40), 360);
      const c = hsvToRgb(h, 0.9, val);
      return [c.r, c.g, c.b];
    });
  },
};
