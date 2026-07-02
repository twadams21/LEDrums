import { hsvToRgb } from '../../color/color';
import { clamp01, distance, mulberry32, type Vec3 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

interface Particle {
  pos: Vec3;
  vel: Vec3;
  /** Particle hue (degrees). */
  hue: number;
  /** Remaining life, ms. */
  life: number;
  /** Total life at spawn, ms (for fade). */
  maxLife: number;
}

export interface ConfettiBurstState {
  particles: Particle[];
  rng: () => number;
  lastSeq: number;
}

const SEED = 0xc0ffe771;
const MAX_PARTICLES = 4096;

/**
 * Confetti Burst: each new trigger spawns N colored particles at the struck drum's
 * origin, launched in random directions and pulled down by gravity. Positions advance
 * per dt; the nearest pixel to each particle lights in its color; particles fade and
 * expire as their life runs out. Stateful + seeded for deterministic replay (R13).
 */
export const confettiBurst: EffectGenerator<ConfettiBurstState> = {
  id: 'confetti-burst',
  name: 'Confetti Burst',
  category: 'particle',
  paramSpec: [
    { key: 'count', label: 'Particles / Hit', type: 'number', default: 24, min: 1, max: 256, step: 1 },
    { key: 'spread', label: 'Spread', type: 'number', default: 1.4, min: 0.05, max: 8, step: 0.05, unit: 'mm/ms' },
    { key: 'gravity', label: 'Gravity', type: 'number', default: 0.004, min: 0, max: 0.05, step: 0.001, unit: 'mm/ms²' },
    { key: 'life', label: 'Life', type: 'number', default: 1200, min: 100, max: 6000, unit: 'ms' },
    { key: 'baseHue', label: 'Base Hue', type: 'number', default: 0, min: 0, max: 360, unit: '°' },
    { key: 'hueSpan', label: 'Hue Span', type: 'number', default: 360, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState(_model: PixelModel): ConfettiBurstState {
    return { particles: [], rng: mulberry32(SEED), lastSeq: 0 };
  },
  render(ctx, params, fb, state) {
    const count = Math.max(1, Math.round(pnum(params, 'count', 24)));
    const spread = pnum(params, 'spread', 1.4);
    const gravity = pnum(params, 'gravity', 0.004);
    const life = Math.max(1, pnum(params, 'life', 1200));
    // Multi-colour: particles pick a hue within [baseHue, baseHue + hueSpan]. Defaults
    // (baseHue 0, hueSpan 360) reproduce the old full-spectrum `rng() * 360` exactly.
    const baseHue = pnum(params, 'baseHue', 0);
    const hueSpan = pnum(params, 'hueSpan', 360);
    const sat = pnum(params, 'saturation', 1);
    const bri = pnum(params, 'brightness', 1);
    const rng = state.rng;

    // Spawn particles for each newly-arrived trigger (process once via seq).
    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;
      const origin = drum.effectOriginWorld;
      for (let k = 0; k < count; k++) {
        if (state.particles.length >= MAX_PARTICLES) break;
        // Random direction on a sphere.
        const theta = rng() * Math.PI * 2;
        const z = rng() * 2 - 1;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        const sp = spread * (0.5 + rng()) * trig.velocity;
        state.particles.push({
          pos: { ...origin },
          vel: { x: r * Math.cos(theta) * sp, y: r * Math.sin(theta) * sp, z: z * sp },
          hue: baseHue + rng() * hueSpan,
          life,
          maxLife: life,
        });
      }
    }

    // Advance particles by dt; apply gravity (pulls along world -Z).
    const dt = ctx.dt;
    const alive: Particle[] = [];
    for (const pt of state.particles) {
      pt.life -= dt;
      if (pt.life <= 0) continue;
      pt.vel.z -= gravity * dt;
      pt.pos = {
        x: pt.pos.x + pt.vel.x * dt,
        y: pt.pos.y + pt.vel.y * dt,
        z: pt.pos.z + pt.vel.z * dt,
      };
      alive.push(pt);
    }
    state.particles = alive;

    // Light the nearest pixel to each particle, faded by remaining life.
    if (ctx.model.pixels.length === 0) return;
    // Radius within which a particle illuminates: a fraction of the kit size.
    const reach = Math.max(40, ctx.model.bounds.size * 0.08);
    for (const pt of state.particles) {
      let bestId = -1;
      let bestDist = Infinity;
      for (const px of ctx.model.pixels) {
        const d = distance(px.world, pt.pos);
        if (d < bestDist) {
          bestDist = d;
          bestId = px.id;
        }
      }
      if (bestId < 0 || bestDist > reach) continue;
      const fade = clamp01(pt.life / pt.maxLife);
      const prox = 1 - bestDist / reach;
      const v = clamp01(bri * fade * prox);
      if (v < 0.004) continue;
      const rgb = hsvToRgb(pt.hue, sat, v);
      fb.max(bestId, rgb.r, rgb.g, rgb.b, v);
    }
  },
};
