import { hsvToRgb } from '../../color/color';
import { pnum, pstr, type EffectGenerator } from '../types';

type Axis = 'x' | 'y' | 'z';
type WipeMode = 'band' | 'wipe';

/**
 * 3D Wipe: a plane sweeps through the kit along an axis. `band` lights a moving
 * stripe near the plane; `wipe` lights everything the plane has passed
 * (design "2D plane passing through the kit in any given rotational axis").
 */
export const wipe3d: EffectGenerator = {
  id: 'wipe-3d',
  name: '3D Wipe',
  category: 'wash',
  paramSpec: [
    { key: 'axis', label: 'Axis', type: 'enum', default: 'x', options: ['x', 'y', 'z'] },
    { key: 'mode', label: 'Mode', type: 'enum', default: 'band', options: ['band', 'wipe'] },
    { key: 'hue', label: 'Hue', type: 'number', default: 190, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'Speed', type: 'number', default: 0.5, min: 0.02, max: 4, step: 0.01, unit: 'Hz' },
    { key: 'width', label: 'Band Width', type: 'number', default: 120, min: 10, max: 800, unit: 'mm' },
  ],
  render(ctx, params, fb) {
    const axis = pstr(params, 'axis', 'x') as Axis;
    const mode = pstr(params, 'mode', 'band') as WipeMode;
    const hue = pnum(params, 'hue', 190);
    const bri = pnum(params, 'brightness', 0.9);
    const speed = pnum(params, 'speed', 0.5);
    const width = Math.max(1, pnum(params, 'width', 120));

    const min = ctx.model.bounds.min[axis];
    const max = ctx.model.bounds.max[axis];
    const span = max - min || 1;
    const phase = (ctx.timeMs * 0.001 * speed) % 1;
    const planePos = min + phase * span;
    const rgb = hsvToRgb(hue, 1, bri);

    for (const p of ctx.model.pixels) {
      const proj = p.world[axis];
      if (mode === 'band') {
        const d = Math.abs(proj - planePos);
        if (d > width) continue;
        const falloff = 1 - d / width;
        fb.max(p.id, rgb.r * falloff, rgb.g * falloff, rgb.b * falloff, falloff);
      } else {
        if (proj <= planePos) fb.max(p.id, rgb.r, rgb.g, rgb.b, 1);
      }
    }
  },
};
