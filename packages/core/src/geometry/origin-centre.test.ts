import { describe, expect, it } from 'vitest';
import { parseKit, type KitConfig } from './kit-schema';
import { CURRENT_KIT_VERSION } from './kit-migrations';
import { buildPixelModel, type PixelModel } from './pixel-model';
import type { Vec3 } from '../math';

/* B3 golden suite — the drum's `origin` is its GEOMETRIC CENTRE (midpoint of the hoop stack),
   flip is a rotation IN PLACE about that centre (world position invariant, only orientation
   changes), and the effect/hit origin is the centre of the FIRST hoop (the skin). Pre-B3 (v<4)
   kits anchored the origin at the first hoop; such a file is now REJECTED at load rather than
   shifted (the v7 floor — see kit-migrations.ts), so only the centre convention is tested here. */

/** Single-drum kit. hoopCount 4 × 50mm spacing → halfStack 75mm unless overridden. */
function kit(overrides: Record<string, unknown> = {}): KitConfig {
  return parseKit({
    version: CURRENT_KIT_VERSION,
    global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
    drums: [
      {
        id: 'kick',
        diameterIn: 12,
        hoopSpacingMm: 50,
        hoopCount: 4,
        pixelsPerHoop: 8,
        localSpinDeg: 0,
        startAngleDeg: 0,
        origin: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        ...overrides,
      },
    ],
  });
}

/** Centroid of a full hoop ring in world space = the hoop's centre point (angular sweep cancels). */
function hoopCentre(model: PixelModel, hoopIndex: number): Vec3 {
  const ps = model.pixels.filter((p) => p.hoopIndex === hoopIndex);
  const sum = ps.reduce((a, p) => ({ x: a.x + p.world.x, y: a.y + p.world.y, z: a.z + p.world.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  return { x: sum.x / ps.length, y: sum.y / ps.length, z: sum.z / ps.length };
}

const closeToVec = (got: Vec3, want: Vec3, digits = 9) => {
  expect(got.x).toBeCloseTo(want.x, digits);
  expect(got.y).toBeCloseTo(want.y, digits);
  expect(got.z).toBeCloseTo(want.z, digits);
};

describe('B3 — origin is the drum geometric centre', () => {
  it('a single unrotated drum: pixel bounds centre equals the origin', () => {
    const origin = { x: 120, y: -40, z: 300 };
    const model = buildPixelModel(kit({ origin }));
    // Stack spans [-75, +75] local Z about the origin; the ring is symmetric in X/Y → the
    // whole-drum bounds centre sits exactly on the origin.
    closeToVec(model.bounds.center, origin, 6);
  });

  it('origin is the MIDPOINT of the first and last hoop centres (rotation-invariant)', () => {
    const origin = { x: 10, y: 20, z: 30 };
    const model = buildPixelModel(kit({ origin, rotation: { x: 18, y: -35, z: 47 } }));
    const first = hoopCentre(model, 1);
    const last = hoopCentre(model, 4);
    const midpoint = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, z: (first.z + last.z) / 2 };
    closeToVec(midpoint, origin, 6);
  });
});

describe('B3 — flip rotates the drum in place (world position invariant)', () => {
  const off = () => buildPixelModel(kit({ flip: false, origin: { x: 100, y: 40, z: 20 }, rotation: { x: 12, y: 34, z: 56 } }));
  const on = () => buildPixelModel(kit({ flip: true, origin: { x: 100, y: 40, z: 20 }, rotation: { x: 12, y: 34, z: 56 } }));

  it('drum-centre world position is unchanged when flip toggles', () => {
    closeToVec(on().bounds.center, off().bounds.center, 6);
  });

  it('the whole world footprint (bounds min/max) is invariant — the drum only re-orients', () => {
    const a = off();
    const b = on();
    closeToVec(b.bounds.min, a.bounds.min, 6);
    closeToVec(b.bounds.max, a.bounds.max, 6);
  });

  it('orientation DOES change: the skin (first hoop) swaps to the far end on flip', () => {
    const a = off();
    const b = on();
    // Flipped first-hoop centre lands where the unflipped LAST hoop centre was (skin moved).
    closeToVec(hoopCentre(b, 1), hoopCentre(a, 4), 6);
    // ...so the effect origin genuinely moves (it is not a no-op reflection).
    const moved = Math.hypot(
      b.drums[0]!.effectOriginWorld.x - a.drums[0]!.effectOriginWorld.x,
      b.drums[0]!.effectOriginWorld.y - a.drums[0]!.effectOriginWorld.y,
      b.drums[0]!.effectOriginWorld.z - a.drums[0]!.effectOriginWorld.z,
    );
    expect(moved).toBeGreaterThan(1); // ~ full stack height apart
  });
});

describe('B3 — effect/hit origin is the centre of the first hoop (the skin)', () => {
  it('effectOriginWorld equals the first-hoop centroid (unflipped)', () => {
    const model = buildPixelModel(kit({ origin: { x: 5, y: -7, z: 11 }, rotation: { x: 8, y: 16, z: 24 } }));
    closeToVec(model.drums[0]!.effectOriginWorld, hoopCentre(model, 1), 6);
  });

  it('effectOriginWorld follows the skin under flip (tracks the first hoop, not a fixed end)', () => {
    const model = buildPixelModel(kit({ flip: true, origin: { x: 5, y: -7, z: 11 }, rotation: { x: 8, y: 16, z: 24 } }));
    closeToVec(model.drums[0]!.effectOriginWorld, hoopCentre(model, 1), 6);
  });
});
