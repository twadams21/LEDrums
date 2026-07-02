/**
 * Hue Shift / Colorize — rotates or replaces the hue of every pixel in the voice's range,
 * leaving saturation and value untouched (so blacks stay black, whites stay white). The
 * `mode` ENUM (S18 Select control) picks the behaviour:
 *   - `shift`    — add `hue` degrees to each pixel's hue (spin the whole palette).
 *   - `colorize` — set each pixel's hue to `hue` (tint everything one colour, keeping its
 *     original saturation + brightness — a monochrome-ish wash).
 *
 * Per pixel: RGB → HSV, adjust H, HSV → RGB; alpha is preserved. Stateless + pure: a fixed
 * per-pixel colour transform of the current frame, no time, no state, no randomness. A fully
 * desaturated pixel (grey) has no hue, so it is unaffected by either mode — as expected.
 */
import { hsvToRgb, rgbToHsv } from '../../color/color';
import { pnum, pstr } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const hueShift: ModifierDef = {
  id: 'hue-shift',
  name: 'Hue Shift',
  category: 'color',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 60, min: 0, max: 360, step: 1, unit: '°' },
    { key: 'mode', label: 'Mode', type: 'enum', default: 'shift', options: ['shift', 'colorize'] },
  ],

  apply(_ctx, params, fb, range: PixelRange): void {
    const hue = pnum(params, 'hue', 60);
    const colorize = pstr(params, 'mode', 'shift') === 'colorize';
    const src = fb.rgba;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      const { h, s, v } = rgbToHsv(src[j]!, src[j + 1]!, src[j + 2]!);
      const { r, g, b } = hsvToRgb(colorize ? hue : h + hue, s, v);
      src[j] = r;
      src[j + 1] = g;
      src[j + 2] = b;
    }
  },
};
