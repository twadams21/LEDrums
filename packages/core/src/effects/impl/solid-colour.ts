import { hexToRgb } from '../../color/color';
import { pnum, pstr, type EffectGenerator } from '../types';

/**
 * Solid Colour: a flat authored colour over whatever range the voice is scoped to. It reads
 * no clock and no trigger — the voice envelope alone shapes it, so the same generator serves
 * as a held colour wash, a hit flash (short release), or a section base.
 *
 * It is also the host generator for a colour-only SPLICE (see `voice/splice.ts`): a splice
 * that carries a colour but no effect resolves to a sub-voice hosting this generator with
 * its `color` param, so every non-blank splice is one uniform kind of thing and the splice
 * compositor path needs no second "fill" branch.
 */
export const solidColour: EffectGenerator = {
  id: 'solid-colour',
  name: 'Solid Colour',
  category: 'base',
  paramSpec: [
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  render(ctx, params, fb) {
    const { r, g, b } = hexToRgb(pstr(params, 'color', '#ffffff'));
    const bri = pnum(params, 'brightness', 1);
    if (bri <= 0) return;
    const rr = r * bri;
    const gg = g * bri;
    const bb = b * bri;
    for (const p of ctx.model.pixels) fb.set(p.id, rr, gg, bb, 1);
  },
};
