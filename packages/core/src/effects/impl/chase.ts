import { hsvToRgb } from '../../color/color';
import { pnum, type EffectGenerator } from '../types';

/**
 * Chase: one hoop per drum lights at a time, advancing on a beat subdivision
 * (design "16th-note arp moving through each hoop over and over").
 *
 * Voice timebase: the bridge feeds a voice-local `ctx.transport.beat` (age×bpm), so the
 * chase starts at hoop 0 on the hit (beat 0 → step 0) and restarts on retrigger. No body
 * change was needed — the beat read below is now hit-relative. (Tracer for the S26 batch.)
 */
export const chase: EffectGenerator = {
  id: 'chase',
  name: 'Chase',
  category: 'trigger',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 30, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'subdivision', label: 'Subdivision', type: 'number', default: 4, min: 1, max: 16, step: 1 },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 30);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const subdiv = Math.max(1, Math.round(pnum(params, 'subdivision', 4)));
    const step = Math.floor(ctx.transport.beat * subdiv);
    const rgb = hsvToRgb(hue, sat, bri);

    for (const p of ctx.model.pixels) {
      const drum = ctx.model.drumById.get(p.drumId);
      if (!drum) continue;
      const active = ((step % drum.hoopCount) + drum.hoopCount) % drum.hoopCount;
      if (p.hoopIndex === active) fb.set(p.id, rgb.r, rgb.g, rgb.b, 1);
    }
  },
};
