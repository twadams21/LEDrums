import { hsvToRgb } from '../../color/color';
import { pnum, pbool, type EffectGenerator } from '../types';
import { EXP_TAIL_FACTOR } from '../visibility';
import { lifeFade } from '../life-fade';
import type { Framebuffer } from '../../engine/framebuffer';
import type { RenderContext, Trigger } from '../../engine/render-context';

/**
 * Whole Drum: a hit lights every pixel of the struck drum, fading over decayMs
 * (design "all pixels of the DRUM display the same content").
 *
 * `noteHue` folds in the retired Colour Melody effect (U3 merge): with it on, each hit's
 * colour is derived from the note played (note 0..127 → hue 0..360) instead of the fixed
 * `hue` param, so a melody walks the struck drum through the colour wheel.
 *
 * `hoopDelayMs` folds in Follow Hoop (effect chains S03 merge; the UI labels this effect
 * **Simple**): hoop N lights (N-1)·hoopDelayMs after the hit, so the light climbs the drum.
 * 0 (the default) takes the original whole-drum path, byte-for-byte. Above 0 each pixel
 * decays on its own hoop's local age, matching follow-hoop at matched params — except that
 * the decay stays under {@link lifeFade} (an authored envelope holds each hoop at full once
 * it lights), where follow-hoop always applied its own decay.
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
    { key: 'decayMs', label: 'Lifespan', type: 'number', default: 220, min: 10, max: 4000, unit: 'ms', section: 'Timing' },
    { key: 'hoopDelayMs', label: 'Hoop delay', type: 'number', default: 0, min: 0, max: 1000, unit: 'ms', section: 'Timing' },
    { key: 'hue', label: 'Colour', type: 'number', default: 0, min: 0, max: 360, unit: '°', section: 'Colour', widget: { kind: 'colour', keys: ['hue', 'saturation', 'brightness'] } },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01, section: 'Colour', partOf: 'hue' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01, section: 'Colour', partOf: 'hue' },
    { key: 'noteHue', label: 'By note', type: 'bool', default: false, section: 'Colour' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 0);
    const noteHue = pbool(params, 'noteHue', false);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const decay = Math.max(1, pnum(params, 'decayMs', 220));
    const hoopDelay = Math.max(0, pnum(params, 'hoopDelayMs', 0));

    for (const trig of ctx.triggers) {
      if (hoopDelay > 0) {
        renderCascade(ctx, fb, trig, noteHue ? (trig.note / 127) * 360 : hue, sat, bri, decay, hoopDelay);
        continue;
      }
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

/** The `hoopDelayMs > 0` path: each hoop fades on its own local age (follow-hoop's cascade). */
function renderCascade(
  ctx: RenderContext,
  fb: Framebuffer,
  trig: Trigger,
  hue: number,
  sat: number,
  bri: number,
  decay: number,
  hoopDelay: number,
): void {
  const drum = ctx.model.drumById.get(trig.drumId);
  if (!drum) return;
  const end = drum.pixelStart + drum.pixelCount;
  for (let i = drum.pixelStart; i < end; i++) {
    const p = ctx.model.pixels[i]!;
    const localAge = trig.ageMs - (p.hoopIndex - 1) * hoopDelay; // hoopIndex is 1-based: hoop 1 fires at 0ms
    if (localAge < 0) continue;
    const intensity = trig.velocity * lifeFade(ctx, Math.exp(-localAge / decay));
    if (intensity < 0.004) continue;
    const rgb = hsvToRgb(hue, sat, bri * intensity);
    fb.max(p.id, rgb.r, rgb.g, rgb.b, intensity);
  }
}
