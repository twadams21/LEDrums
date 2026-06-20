import { wrap } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';
import { renderUvField } from '../field';

/**
 * A scrolling diagonal rainbow wrapped around each drum: hue is a function of
 * (u+v) so the bands run diagonally, and the whole field scrolls over time.
 */
export const rainbowFlow: EffectGenerator = {
  id: 'rainbow-flow',
  name: 'Rainbow Flow',
  category: 'texture',
  paramSpec: [
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'bands', label: 'Bands', type: 'number', default: 1, min: 0.25, max: 6, step: 0.25 },
    { key: 'speed', label: 'Speed', type: 'number', default: 1, min: -5, max: 5, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const bri = pnum(params, 'brightness', 1);
    const sat = pnum(params, 'saturation', 1);
    const bands = pnum(params, 'bands', 1);
    const sp = pnum(params, 'speed', 1);

    renderUvField(ctx, fb, 'cylindrical', (u, v, t) => {
      const hue = wrap((u + v) * 360 * bands + t * sp * 60, 360);
      const c = hsvToRgb(hue, sat, bri);
      return [c.r, c.g, c.b];
    });
  },
};
