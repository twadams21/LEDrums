import { describe, expect, it } from 'vitest';
import { eulerXYZApply } from './euler';
import { CURRENT_KIT_VERSION, migrateKit, parseKit, type KitConfig } from './kit-schema';
import { buildPixelModel, type PixelModel } from './pixel-model';
import type { Vec3 } from '../math';

/* B3 golden suite — the drum's `origin` is its GEOMETRIC CENTRE (midpoint of the hoop stack),
   flip is a rotation IN PLACE about that centre (world position invariant, only orientation
   changes), and the effect/hit origin is the centre of the FIRST hoop (the skin). Pre-B3 kits
   anchored the origin at the first hoop; the v<4 migrator shifts stored origins to the centre
   convention so drums do NOT move on screen — migrate the data, not the drums. */

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

describe('B3 — origin migration preserves world position (migrate the data, not the drums)', () => {
  // A pre-B3 kit (version 3) whose origin is anchored at the FIRST hoop, the old convention.
  const legacyGlobal = { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000, expanded: false };
  const legacyDrum = {
    id: 'kick',
    diameterIn: 12,
    hoopSpacingMm: 50,
    hoopCount: 4,
    pixelsPerHoop: 8,
    localSpinDeg: 0,
    startAngleDeg: 0,
    origin: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const legacyRaw = { version: 3, global: legacyGlobal, drums: [legacyDrum], outputs: [] };

  it('an unrotated legacy kit: hoops keep their OLD world Z (0,50,100,150), local Z re-centres', () => {
    const model = buildPixelModel(parseKit(legacyRaw));
    // Old model put hoop h at world z = h*50 (origin at hoop 1). After migration the origin moved
    // to +75mm and the local frame re-centred (-75..+75), so world Z is byte-identical: nothing moved.
    const worldZ = [1, 2, 3, 4].map((h) => Math.round(hoopCentre(model, h).z));
    expect(worldZ).toEqual([0, 50, 100, 150]);
    const localZ = [1, 2, 3, 4].map((h) => model.pixels.find((p) => p.hoopIndex === h)!.local.z);
    expect(localZ).toEqual([-75, -25, 25, 75]);
  });

  it('a rotated legacy kit: the skin (first hoop) stays exactly where it was authored', () => {
    const rotated = { ...legacyRaw, drums: [{ ...legacyDrum, origin: { x: 200, y: -50, z: 90 }, rotation: { x: 15, y: 40, z: -25 } }] };
    const model = buildPixelModel(parseKit(rotated));
    // Old convention: origin WAS the first-hoop centre. Migration must leave the first hoop there.
    closeToVec(hoopCentre(model, 1), { x: 200, y: -50, z: 90 }, 6);
  });

  it('migrated origin = old origin + R·(0,0,halfStack); version stamped to 4', () => {
    const rotation = { x: 15, y: 40, z: -25 };
    const oldOrigin = { x: 200, y: -50, z: 90 };
    const migrated = migrateKit({ ...legacyRaw, drums: [{ ...legacyDrum, origin: oldOrigin, rotation }] }) as {
      version: number;
      drums: Array<{ origin: Vec3 }>;
    };
    const halfStack = ((4 - 1) * 50) / 2; // 75
    const shift = eulerXYZApply({ x: 0, y: 0, z: halfStack }, rotation);
    closeToVec(migrated.drums[0]!.origin, {
      x: oldOrigin.x + shift.x,
      y: oldOrigin.y + shift.y,
      z: oldOrigin.z + shift.z,
    });
    expect(migrated.version).toBe(CURRENT_KIT_VERSION);
  });

  it('a flipped legacy drum shifts the OTHER way so it, too, stays put', () => {
    const rotation = { x: 0, y: 0, z: 0 };
    const oldOrigin = { x: 0, y: 0, z: 0 };
    const migrated = migrateKit({
      version: 3,
      global: legacyGlobal,
      drums: [{ ...legacyDrum, flip: true, origin: oldOrigin, rotation }],
      outputs: [],
    }) as { drums: Array<{ origin: Vec3 }> };
    // Old flipped model extended the stack in -Z from hoop 1; the centre is therefore BELOW the
    // old origin, so the shift is negative (−halfStack) — the mirror image of the unflipped case.
    expect(migrated.drums[0]!.origin.z).toBeCloseTo(-75, 9);
  });

  it('is idempotent — a current-version kit is returned untouched (survives future bumps)', () => {
    const currentRaw = { ...legacyRaw, version: CURRENT_KIT_VERSION };
    expect(migrateKit(currentRaw)).toBe(currentRaw);
    const once = migrateKit(legacyRaw);
    expect(migrateKit(once)).toEqual(once);
  });
});
