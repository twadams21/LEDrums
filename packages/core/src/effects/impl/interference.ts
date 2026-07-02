import { hsvToRgb } from '../../color/color';
import { renderUvField } from '../field';
import { pnum, type EffectGenerator } from '../types';

/**
 * Moiré interference: two sine gratings rotate in opposite directions at slightly
 * different frequencies, so their product beats into shifting moiré bands (cylindrical).
 */
export const interference: EffectGenerator = {
  id: 'interference',
  name: 'Interference',
  category: 'texture',
  paramSpec: [
    { key: 'freq', label: 'Frequency', type: 'number', default: 24, min: 2, max: 80, step: 0.5 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.4, min: 0, max: 4, step: 0.01 },
    { key: 'hue', label: 'Hue', type: 'number', default: 180, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const freq = pnum(params, 'freq', 24);
    const speed = pnum(params, 'speed', 0.4);
    const hue = pnum(params, 'hue', 180);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const theta = t * speed;
      const c1 = Math.cos(theta);
      const s1 = Math.sin(theta);
      const c2 = Math.cos(-theta);
      const s2 = Math.sin(-theta);
      const g1 = Math.sin((u * c1 + v * s1) * freq);
      const g2 = Math.sin((u * c2 + v * s2) * freq * 1.05);
      const b = g1 * g2 * 0.5 + 0.5; // [0,1] moiré intensity
      const col = hsvToRgb(hue + b * 80 + t * 20, sat, bri * b);
      return [col.r, col.g, col.b];
    });
  },
};
