/**
 * Levels — the tone-shaping modifier: saturation, brightness, and invert in one pass over the
 * voice's range. Saturation and brightness are applied in HSV (so brightness scales value and
 * saturation pulls toward / past grey without shifting hue), then invert flips the RGB result:
 *
 *   hsv.s *= saturation   (0 ⇒ greyscale, 1 ⇒ unchanged, >1 ⇒ boosted, clamped in hsvToRgb)
 *   hsv.v *= brightness   (0 ⇒ black, 1 ⇒ unchanged, >1 ⇒ brighter, clamped in hsvToRgb)
 *   rgb    = hsvToRgb(...)
 *   if invert: rgb = 1 − rgb
 *
 * Alpha is preserved. Stateless + pure: a fixed per-pixel colour transform of the current
 * frame — no time, no state, no randomness. All-default params (sat 1, bright 1, invert off)
 * are identity up to the HSV round-trip.
 */
import { hsvToRgb, rgbToHsv } from '../../color/color';
import { pbool, pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const levels: ModifierDef = {
  id: 'levels',
  name: 'Levels',
  category: 'color',
  paramSpec: [
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 2, step: 0.05 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 2, step: 0.05 },
    { key: 'invert', label: 'Invert', type: 'bool', default: false },
  ],

  apply(_ctx, params, fb, range: PixelRange): void {
    const saturation = pnum(params, 'saturation', 1);
    const brightness = pnum(params, 'brightness', 1);
    const invert = pbool(params, 'invert', false);
    const src = fb.rgba;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      const hsv = rgbToHsv(src[j]!, src[j + 1]!, src[j + 2]!);
      const { r, g, b } = hsvToRgb(hsv.h, hsv.s * saturation, hsv.v * brightness);
      src[j] = invert ? 1 - r : r;
      src[j + 1] = invert ? 1 - g : g;
      src[j + 2] = invert ? 1 - b : b;
    }
  },
};
