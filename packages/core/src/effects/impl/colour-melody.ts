import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

export interface ColourMelodyState {
  hue: number;
  value: number;
  lastSeq: number;
  active: boolean;
}

/**
 * Colour Melody: each note maps to a hue across the kit, held until the next note
 * (design "each note is a different colour"). Note 0..127 → hue 0..360, value follows
 * velocity.
 */
export const colourMelody: EffectGenerator<ColourMelodyState> = {
  id: 'colour-melody',
  name: 'Colour Melody',
  category: 'trigger',
  paramSpec: [
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState(): ColourMelodyState {
    return { hue: 0, value: 0, lastSeq: 0, active: false };
  },
  render(ctx, params, fb, state) {
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);

    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      state.hue = (trig.note / 127) * 360;
      state.value = trig.velocity;
      state.active = true;
    }

    if (!state.active || state.value <= 0) return;
    const rgb = hsvToRgb(state.hue, sat, bri * state.value);
    for (const p of ctx.model.pixels) fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
  },
};
