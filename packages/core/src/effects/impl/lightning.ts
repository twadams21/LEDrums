import { hsvToRgb } from '../../color/color';
import { clamp01, mulberry32, type Vec3 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { buildPixelGrid, forEachPixelWithin, type PixelGrid } from '../../geometry/pixel-grid';
import { pnum, type EffectGenerator } from '../types';

const STEPS = 14;

export interface LightningState {
  /** Spatial index over the model's pixels; rebuilt if the model instance changes. */
  grid: PixelGrid;
}

/** Random unit-ish direction from a seeded RNG. */
function randomDir(rng: () => number): Vec3 {
  // Sample on a sphere via two angles.
  const theta = rng() * Math.PI * 2;
  const z = rng() * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

/**
 * Lightning: each new trigger fires a jagged, branching bolt outward from the struck
 * drum's effect origin. The path is stepped through 3D space (seeded from trig.seq for
 * per-hit determinism), lighting the nearest pixel at each step, and the whole bolt
 * fades over `decayMs`. Branches fork off the main bolt for a forked-lightning look.
 *
 * Voice timebase (S26): already intrinsically hit-relative — the bolt is seeded per-hit
 * (`trig.seq`) and its envelope fades on `trig.ageMs`, so it restarts on retrigger with no
 * bridge clock swap. The `timebase:'voice'` flag is a byte-parity declaration so the
 * thumbnail renderer (S27) drives the fade with a looping age.
 */
export const lightning: EffectGenerator<LightningState> = {
  id: 'lightning',
  name: 'Lightning',
  category: 'particle',
  timebase: 'voice',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 200, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 0.35, min: 0, max: 1, step: 0.01 },
    { key: 'boltWidth', label: 'Bolt Width', type: 'number', default: 120, min: 20, max: 600, unit: 'mm' },
    { key: 'decayMs', label: 'Decay', type: 'number', default: 150, min: 20, max: 1500, unit: 'ms' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  createState(model: PixelModel): LightningState {
    return { grid: buildPixelGrid(model) };
  },
  render(ctx, params, fb, state) {
    // Defensive: callers that predate LightningState may pass no state at all.
    const grid =
      state?.grid && state.grid.model === ctx.model ? state.grid : buildPixelGrid(ctx.model);
    if (state) state.grid = grid;
    const hue = pnum(params, 'hue', 200);
    const sat = pnum(params, 'saturation', 0.35);
    const width = Math.max(1, pnum(params, 'boltWidth', 120));
    const decay = Math.max(1, pnum(params, 'decayMs', 150));
    const bri = pnum(params, 'brightness', 1);

    // Step length scales with kit size so bolts cross the whole rig.
    const stepLen = Math.max(20, ctx.model.bounds.size / STEPS);

    for (const trig of ctx.triggers) {
      const env = trig.velocity * Math.exp(-trig.ageMs / decay);
      if (env < 0.004) continue;
      const drum = ctx.model.drumById.get(trig.drumId);
      if (!drum) continue;

      // Per-hit deterministic RNG seeded from the trigger seq (R13).
      const rng = mulberry32((trig.seq >>> 0) + 1);
      const origin = drum.effectOriginWorld;

      // Walk a jagged main bolt, occasionally forking a short branch.
      let pos: Vec3 = { ...origin };
      let dir = randomDir(rng);
      const branchStarts: { pos: Vec3; dir: Vec3 }[] = [];

      for (let s = 0; s < STEPS; s++) {
        // Jitter direction for a jagged path.
        dir = {
          x: dir.x + (rng() - 0.5) * 0.9,
          y: dir.y + (rng() - 0.5) * 0.9,
          z: dir.z + (rng() - 0.5) * 0.9,
        };
        const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
        pos = { x: pos.x + (dir.x / len) * stepLen, y: pos.y + (dir.y / len) * stepLen, z: pos.z + (dir.z / len) * stepLen };
        // Head fades toward the tip of the bolt.
        const along = 1 - s / STEPS;
        lightNear(grid, fb, pos, width, hue, sat, env * (0.4 + 0.6 * along), bri);
        // Occasionally spawn a branch.
        if (rng() < 0.25 && branchStarts.length < 4) {
          branchStarts.push({ pos: { ...pos }, dir: randomDir(rng) });
        }
      }

      // Render the branches (shorter, dimmer).
      for (const br of branchStarts) {
        let bpos = { ...br.pos };
        let bdir = br.dir;
        for (let s = 0; s < Math.floor(STEPS / 2); s++) {
          bdir = {
            x: bdir.x + (rng() - 0.5) * 1.0,
            y: bdir.y + (rng() - 0.5) * 1.0,
            z: bdir.z + (rng() - 0.5) * 1.0,
          };
          const len = Math.hypot(bdir.x, bdir.y, bdir.z) || 1;
          bpos = {
            x: bpos.x + (bdir.x / len) * stepLen,
            y: bpos.y + (bdir.y / len) * stepLen,
            z: bpos.z + (bdir.z / len) * stepLen,
          };
          lightNear(grid, fb, bpos, width, hue, sat, env * 0.5, bri);
        }
      }
    }
  },
};

/** Light pixels within `width` mm of a world-space point along the bolt path. */
function lightNear(
  grid: PixelGrid,
  fb: { max: (id: number, r: number, g: number, b: number, a: number) => void },
  point: Vec3,
  width: number,
  hue: number,
  sat: number,
  env: number,
  bri: number,
): void {
  if (env < 0.004) return;
  // Radius query over the spatial grid — same pixel set as the old whole-model scan
  // (it skipped d > width), and fb.max is order-independent, so output is identical.
  forEachPixelWithin(grid, point, width, (id, d) => {
    const falloff = 1 - d / width;
    const v = clamp01(bri * env * falloff);
    if (v < 0.004) return;
    // Bright blue-white core by default (low saturation); now controllable.
    const rgb = hsvToRgb(hue, sat, v);
    fb.max(id, rgb.r, rgb.g, rgb.b, v);
  });
}
