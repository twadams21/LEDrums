import { distance } from '../../math';
import { hsvToRgb } from '../../color/color';
import { pnum, pstr, type EffectGenerator } from '../types';
import { EXP_TAIL_FACTOR } from '../visibility';
import { lifeFade } from '../life-fade';

export type WashMode = 'out' | 'in' | 'bounce';

/**
 * The expanding wave radius (mm) for a given hit age. `out` grows from the origin,
 * `in` collapses from `reach`, `bounce` goes out then back. Exported for testing.
 */
export function waveRadius(mode: WashMode, ageMs: number, speed: number, reach: number): number {
  const d = ageMs * speed; // speed in mm/ms
  switch (mode) {
    case 'out':
      return Math.min(d, reach);
    case 'in':
      return Math.max(reach - d, 0);
    case 'bounce': {
      const phase = d % (2 * reach);
      return phase <= reach ? phase : 2 * reach - phase;
    }
  }
}

/**
 * 3D Radial Wash: a shell of light radiates from the hit drum's origin through the
 * whole kit in 3D space (design "wash radiates out from the origin of the hit").
 *
 * Voice timebase (S26): already intrinsically hit-relative — the shell radius is a pure
 * function of `trig.ageMs`, so it restarts on retrigger without any bridge clock swap. The
 * `timebase:'voice'` flag is a byte-parity declaration that records this and lets the
 * thumbnail renderer (S27) drive it with a looping age. (Doc 06 §A reference effect.)
 */
export const radialWash: EffectGenerator = {
  id: 'radial-wash',
  name: '3D Radial Wash',
  category: 'wash',
  timebase: 'voice',
  // Not a cutoff: the wave fades on exp(-age/decayMs),
  // so it stays visible for EXP_TAIL_FACTOR time constants and the voice must too.
  voiceLife: { key: 'decayMs', unit: 'ms', factor: EXP_TAIL_FACTOR },
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 280, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'mode', label: 'Mode', type: 'enum', default: 'out', options: ['out', 'in', 'bounce'] },
    { key: 'speed', label: 'Speed', type: 'number', default: 1.2, min: 0.05, max: 6, step: 0.05, unit: 'mm/ms' },
    { key: 'width', label: 'Width', type: 'number', default: 180, min: 10, max: 800, unit: 'mm' },
    { key: 'reach', label: 'Reach', type: 'number', default: 1200, min: 100, max: 4000, unit: 'mm' },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 500, min: 50, max: 4000, unit: 'ms' },
  ],
  render(ctx, params, fb) {
    const hue = pnum(params, 'hue', 280);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 0.9);
    const mode = pstr(params, 'mode', 'out') as WashMode;
    const speed = pnum(params, 'speed', 1.2);
    const width = Math.max(1, pnum(params, 'width', 180));
    const reach = pnum(params, 'reach', 1200);
    const decay = Math.max(1, pnum(params, 'decayMs', 500));

    for (const trig of ctx.triggers) {
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      const envelope = trig.velocity * lifeFade(ctx, Math.exp(-trig.ageMs / decay));
      if (envelope < 0.004) continue;
      const radius = waveRadius(mode, trig.ageMs, speed, reach);
      const origin = drum.effectOriginWorld;
      for (const p of ctx.model.pixels) {
        const band = Math.abs(distance(p.world, origin) - radius);
        if (band > width) continue;
        const falloff = 1 - band / width;
        const intensity = envelope * falloff;
        if (intensity < 0.004) continue;
        const rgb = hsvToRgb(hue, sat, bri * intensity);
        fb.max(p.id, rgb.r, rgb.g, rgb.b, intensity);
      }
    }
  },
};
