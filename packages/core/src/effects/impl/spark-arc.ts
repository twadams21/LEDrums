import { hsvToRgb } from '../../color/color';
import { clamp01, distance, mulberry32, type Vec3 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { buildPixelGrid, forEachPixelWithin, type PixelGrid } from '../../geometry/pixel-grid';
import { createEmitterState, updateEmissions, type EmitterState } from '../emitter';
import { pnum, type EffectGenerator } from '../types';

interface Arc {
  /** Quadratic bezier through 3D space: source origin → lofted control → target origin. */
  from: Vec3;
  ctrl: Vec3;
  to: Vec3;
  /** Pixel range of the target drum, for the landing flash. */
  targetStart: number;
  targetEnd: number;
  targetOrigin: Vec3;
  /** Flash radius sized to the TARGET drum's geometry (its pixels sit a full
      drum-radius from the origin, so a kit-fraction reach can miss entirely). */
  targetReach: number;
}

export interface SparkArcState {
  em: EmitterState<Arc>;
  rng: () => number;
  grid: PixelGrid;
}

const SEED = 0x5baacc;
/** Bezier samples lighting the head + trail each frame. */
const SAMPLES = 12;
/** Landing flash decay, ms. */
const FLASH_MS = 260;

function bezier(a: Vec3, c: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * c.z + t * t * b.z;
  return out;
}

/**
 * Spark Arc: a hit hurls a spark that arcs THROUGH THE AIR from the struck drum
 * to another drum — a lofted 3D bezier whose path only exists because the kit is
 * a real object with real space between the drums. The spark flies over
 * `travelBeats`, dragging a fading tail, then detonates a radial flash on the
 * drum it lands on. Each hit picks its target and loft seededly, so a roll
 * scatters distinct arcs kit-wide that all replay identically.
 *
 * Uses the pixel spatial grid for the flight path (radius queries along the
 * bezier), so cost scales with the beam, not the kit.
 */
export const sparkArc: EffectGenerator<SparkArcState> = {
  id: 'spark-arc',
  name: 'Spark Arc',
  category: 'particle',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 45, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.6, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'travelBeats', label: 'Travel', type: 'number', default: 1, min: 0.25, max: 4, step: 0.25, unit: 'beats' },
    { key: 'width', label: 'Beam Width', type: 'number', default: 110, min: 20, max: 400, unit: 'mm' },
    { key: 'trail', label: 'Trail', type: 'number', default: 0.35, min: 0.05, max: 1, step: 0.05 },
    { key: 'loft', label: 'Loft', type: 'number', default: 0.5, min: 0, max: 1.5, step: 0.05 },
    { key: 'flashHue', label: 'Flash Hue', type: 'number', default: 20, min: 0, max: 360, unit: '°' },
  ],
  createState(model: PixelModel, seed?: number): SparkArcState {
    return { em: createEmitterState(), rng: mulberry32(seed ?? SEED), grid: buildPixelGrid(model) };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 45);
    const sat = pnum(params, 'saturation', 0.6);
    const bri = pnum(params, 'brightness', 1);
    const travelBeats = Math.max(0.05, pnum(params, 'travelBeats', 1));
    const width = Math.max(1, pnum(params, 'width', 110));
    const trail = Math.max(0.01, pnum(params, 'trail', 0.35));
    const loft = pnum(params, 'loft', 0.5);
    const flashHue = pnum(params, 'flashHue', 20);

    if (!state.grid || state.grid.model !== ctx.model) state.grid = buildPixelGrid(ctx.model);
    const model = ctx.model;
    const bpm = ctx.transport.bpm || 120;
    const travelMs = travelBeats * (60000 / bpm);
    const ttlMs = travelMs + FLASH_MS * 2;

    const emissions = updateEmissions(state.em, ctx, ttlMs, (trig) => {
      const source = model.drumById.get(trig.drumId);
      const from = source ? source.effectOriginWorld : model.bounds.center;
      // Seeded target: any OTHER drum; a single-drum rig arcs up and back onto itself.
      const others = model.drums.filter((d) => d.drumId !== trig.drumId);
      const target = others.length
        ? others[Math.floor(state.rng() * others.length) % others.length]!
        : model.drumById.get(trig.drumId);
      const to = target ? target.effectOriginWorld : model.bounds.center;
      // Loft the control point above the midpoint, with seeded lateral scatter.
      const size = Math.max(200, model.bounds.size);
      const ctrl: Vec3 = {
        x: (from.x + to.x) / 2 + (state.rng() - 0.5) * size * 0.3,
        y: (from.y + to.y) / 2 + (state.rng() - 0.5) * size * 0.3,
        z: Math.max(from.z, to.z) + size * loft * (0.6 + 0.8 * state.rng()),
      };
      return {
        from,
        ctrl,
        to,
        targetStart: target ? target.pixelStart : 0,
        targetEnd: target ? target.pixelStart + target.pixelCount : 0,
        targetOrigin: to,
        targetReach: target ? Math.max(120, target.radiusMm * 2) : 120,
      };
    });
    if (emissions.length === 0) return;

    const point: Vec3 = { x: 0, y: 0, z: 0 };
    for (const em of emissions) {
      const arc = em.data;
      const head = clamp01(em.ageMs / travelMs);
      const level = em.velocity * bri;

      // Flight: sample the bezier from the tail to the head, dimming backwards.
      if (em.ageMs <= travelMs) {
        const tail = Math.max(0, head - trail);
        for (let s = 0; s < SAMPLES; s++) {
          const f = s / (SAMPLES - 1);
          const t = tail + (head - tail) * f;
          bezier(arc.from, arc.ctrl, arc.to, t, point);
          const along = 0.25 + 0.75 * f; // brightest at the head
          forEachPixelWithin(state.grid, point, width, (id, d) => {
            const v = clamp01(level * along * (1 - d / width));
            if (v < 0.004) return;
            const rgb = hsvToRgb(hue, sat, v);
            fb.max(id, rgb.r, rgb.g, rgb.b, v);
          });
        }
      }

      // Landing flash: radial burst on the target drum, decaying after arrival.
      const sinceLanding = em.ageMs - travelMs;
      if (sinceLanding >= 0 && arc.targetEnd > arc.targetStart) {
        const flash = level * Math.exp(-sinceLanding / FLASH_MS);
        if (flash >= 0.004) {
          const reach = arc.targetReach;
          for (let i = arc.targetStart; i < arc.targetEnd; i++) {
            const p = model.pixels[i]!;
            const d = distance(p.world, arc.targetOrigin);
            if (d > reach) continue;
            const v = clamp01(flash * (1 - (d / reach) * 0.6));
            if (v < 0.004) continue;
            const rgb = hsvToRgb(flashHue, sat, v);
            fb.max(p.id, rgb.r, rgb.g, rgb.b, v);
          }
        }
      }
    }
  },
};
