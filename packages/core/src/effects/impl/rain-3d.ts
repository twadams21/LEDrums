import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32, type Vec3 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { buildPixelGrid, nearestPixelIdWithin, type PixelGrid } from '../../geometry/pixel-grid';
import { distance } from '../../math';
import { pnum, type EffectGenerator } from '../types';

interface Drop {
  pos: Vec3;
  /** Slight per-drop lateral drift, mm/ms. */
  driftX: number;
  driftY: number;
  hueJitter: number;
  /** 1 for ambient drops (respawn at the top); 0 for one-shot hit-burst drops. */
  ambient: number;
}

export interface Rain3dState {
  drops: Drop[];
  rng: () => number;
  grid: PixelGrid;
  lastSeq: number;
  /** Ambient population the pool was seeded for (re-seed if `density` changes). */
  seededCount: number;
}

const SEED = 0xda12d701;
const MAX_DROPS = 512;

/**
 * Rain 3D: drops of light fall through the kit's real airspace — each one lights
 * whatever pixel it is physically nearest as it passes (spatial-grid lookup), so
 * a single drop streaks DOWN a drum shell, vanishes in the gap below, and can
 * catch the next drum on the way — the negative space between drums becomes part
 * of the picture. Ambient drops recycle from the sky forever; every hit bursts a
 * clutch of extra drops above the struck drum (velocity-scaled) so playing harder
 * makes it pour. Seeded, dt-integrated, deterministic replay.
 */
export const rain3d: EffectGenerator<Rain3dState> = {
  id: 'rain-3d',
  name: 'Rain 3D',
  category: 'particle',
  paramSpec: [
    { key: 'density', label: 'Density', type: 'number', default: 24, min: 0, max: 128, step: 1 },
    { key: 'fallSpeed', label: 'Fall Speed', type: 'number', default: 900, min: 100, max: 4000, step: 10, unit: 'mm/s' },
    { key: 'hue', label: 'Hue', type: 'number', default: 210, min: 0, max: 360, unit: '°' },
    { key: 'hueJitter', label: 'Hue Jitter', type: 'number', default: 30, min: 0, max: 180, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'hitBurst', label: 'Hit Burst', type: 'number', default: 12, min: 0, max: 64, step: 1 },
  ],
  createState(model: PixelModel, seed?: number): Rain3dState {
    return {
      drops: [],
      rng: mulberry32(seed ?? SEED),
      grid: buildPixelGrid(model),
      lastSeq: 0,
      seededCount: -1,
    };
  },
  render(ctx, params, fb, state) {
    const density = Math.max(0, Math.round(pnum(params, 'density', 24)));
    const fallSpeed = Math.max(1, pnum(params, 'fallSpeed', 900)) / 1000; // mm/ms
    const hue = pnum(params, 'hue', 210);
    const jitter = pnum(params, 'hueJitter', 30);
    const sat = pnum(params, 'saturation', 0.85);
    const bri = pnum(params, 'brightness', 1);
    const hitBurst = Math.max(0, Math.round(pnum(params, 'hitBurst', 12)));

    const model = ctx.model;
    if (model.pixels.length === 0) return;
    if (!state.grid || state.grid.model !== ctx.model) state.grid = buildPixelGrid(ctx.model);
    const { min, max, size } = model.bounds;
    const skyZ = max.z + size * 0.3;
    const floorZ = min.z - size * 0.15;
    const rng = state.rng;

    const spawn = (x: number, y: number, z: number, ambient: number): void => {
      if (state.drops.length >= MAX_DROPS) return;
      state.drops.push({
        pos: { x, y, z },
        driftX: (rng() - 0.5) * 0.05,
        driftY: (rng() - 0.5) * 0.05,
        hueJitter: (rng() * 2 - 1) * jitter,
        ambient,
      });
    };
    const spawnAmbient = (atTop: boolean): void => {
      spawn(
        min.x + rng() * (max.x - min.x),
        min.y + rng() * (max.y - min.y),
        atTop ? skyZ : floorZ + rng() * (skyZ - floorZ),
        1,
      );
    };

    // (Re)seed the ambient pool when density changes — drops scattered through the
    // volume so the rain is already falling on the first frame.
    if (state.seededCount !== density) {
      state.drops = state.drops.filter((d) => !d.ambient);
      for (let i = 0; i < density; i++) spawnAmbient(false);
      state.seededCount = density;
    }

    // Hit bursts: a clutch of drops above the struck drum, count scaled by velocity.
    for (const trig of ctx.triggers) {
      if (trig.seq <= state.lastSeq) continue;
      state.lastSeq = trig.seq;
      const drum = model.drumById.get(trig.drumId);
      if (!drum || hitBurst === 0) continue;
      const o = drum.effectOriginWorld;
      const n = Math.max(1, Math.round(hitBurst * trig.velocity));
      const scatter = Math.max(60, drum.radiusMm * 1.5);
      for (let k = 0; k < n; k++) {
        spawn(
          o.x + (rng() - 0.5) * scatter,
          o.y + (rng() - 0.5) * scatter,
          max.z + size * (0.05 + rng() * 0.25),
          0,
        );
      }
    }

    // Integrate + render + recycle, compacting in place (no per-frame allocation).
    const dt = ctx.dt;
    const reach = Math.max(40, size * 0.08);
    let w = 0;
    for (const drop of state.drops) {
      drop.pos.z -= fallSpeed * dt;
      drop.pos.x += drop.driftX * dt;
      drop.pos.y += drop.driftY * dt;
      if (drop.pos.z < floorZ) {
        if (!drop.ambient) continue; // burst drops die at the floor
        // Ambient drops recycle to the sky at a fresh seeded column.
        drop.pos.x = min.x + rng() * (max.x - min.x);
        drop.pos.y = min.y + rng() * (max.y - min.y);
        drop.pos.z = skyZ;
        drop.hueJitter = (rng() * 2 - 1) * jitter;
      }
      state.drops[w++] = drop;

      const id = nearestPixelIdWithin(state.grid, drop.pos, reach);
      if (id < 0) continue;
      const d = distance(model.pixels[id]!.world, drop.pos);
      const v = clamp01(bri * (1 - d / reach));
      if (v < 0.004) continue;
      const rgb = hsvToRgb(hue + drop.hueJitter, sat, v);
      fb.max(id, rgb.r, rgb.g, rgb.b, v);
    }
    state.drops.length = w;
  },
};
