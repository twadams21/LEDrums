import { hsvToRgb } from '../../color/color';
import { pnum, pbool, type EffectGenerator } from '../types';
import { EXP_TAIL_FACTOR } from '../visibility';
import { lifeFade } from '../life-fade';

/**
 * Whole Drum: a hit lights every pixel of the struck drum, fading over decayMs
 * (design "all pixels of the DRUM display the same content").
 *
 * `noteHue` folds in the retired Colour Melody effect (U3 merge): with it on, each hit's
 * colour is derived from the note played (note 0..127 → hue 0..360) instead of the fixed
 * `hue` param, so a melody walks the struck drum through the colour wheel.
 *
 * Voice timebase (S26): already intrinsically hit-relative — intensity is a pure function
 * of `trig.ageMs`. The `timebase:'voice'` flag is a byte-parity declaration so the thumbnail
 * renderer (S27) drives it with a looping age instead of a frozen age-0 frame.
 */
export const wholeDrum: EffectGenerator = {
  id: 'whole-drum',
  name: 'Whole Drum',
  category: 'trigger',
  timebase: 'voice',
  // Not a cutoff: the struck drum's every pixel fades on exp(-age/decayMs),
  // so it stays visible for EXP_TAIL_FACTOR time constants and the voice must too.
  voiceLife: { key: 'decayMs', unit: 'ms', factor: EXP_TAIL_FACTOR },
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'noteHue', label: 'Note Hue', type: 'bool', default: false },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 220, min: 10, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 0);
    const noteHue = pbool(params, 'noteHue', false);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const decay = Math.max(1, pnum(params, 'decayMs', 220));

    for (const trig of ctx.triggers) {
      const intensity = trig.velocity * lifeFade(ctx, Math.exp(-trig.ageMs / decay));
      if (intensity < 0.004) continue;
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      // Colour Melody merge: derive hue from the note when `noteHue` is on.
      const h = noteHue ? (trig.note / 127) * 360 : hue;
      const rgb = hsvToRgb(h, sat, bri * intensity);
      for (let id = drum.pixelStart; id < drum.pixelStart + drum.pixelCount; id++) {
        fb.max(id, rgb.r, rgb.g, rgb.b, intensity);
      }
    }
  },
};
