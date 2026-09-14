import { describe, expect, it } from 'vitest';
import { buildDmxMap } from '../geometry/dmx-map';
import { CURRENT_KIT_VERSION, migrateKit, parseKit, type KitConfig } from '../geometry/kit-schema';
import { buildPixelModel, type Pixel } from '../geometry/pixel-model';
import type { Vec3 } from '../math';
import { DEFAULT_KIT, defaultProject } from './defaults';
import { parseProject } from './project-schema';

// Frozen pre-Blender default, NOT derived from DEFAULT_KIT. Its v3 origins are first-hoop
// anchors: changing its 60mm spacing before parseKit would silently move the drum centres.
const legacySeed = {
  version: 3,
  units: 'mm',
  global: { ledDensityPxPerM: 30, hoopCount: 4, defaultHoopSpacingMm: 60, maxPixelsPerOutput: 4096 },
  drums: [
    { id: 'kick', label: 'Kick', color: '#5bbcff', diameterIn: 21, pixelsPerHoop: 196,
      origin: { x: 0, y: 430, z: 330 }, rotation: { x: 90, y: 0, z: 0 } },
    { id: 'snare', label: 'Snare', color: '#72d572', diameterIn: 12, pixelsPerHoop: 108,
      origin: { x: -230, y: 0, z: 650 }, rotation: { x: 0, y: 0, z: 0 } },
    { id: 'tom1', label: 'Tom 1', color: '#ff8e72', diameterIn: 12, pixelsPerHoop: 108,
      origin: { x: -120, y: 300, z: 840 }, rotation: { x: 18, y: 0, z: 4 } },
    { id: 'tom2', label: 'Tom 2', color: '#d69cff', diameterIn: 15, pixelsPerHoop: 136,
      origin: { x: 360, y: 40, z: 620 }, rotation: { x: 0, y: 0, z: 0 } },
  ].map((drum) => ({ ...drum, hoopSpacingMm: 60, localSpinDeg: 270, startAngleDeg: 0 })),
  outputs: [],
};
const previousKit = parseKit(legacySeed);
const previousModel = buildPixelModel(previousKit);
const model = buildPixelModel(DEFAULT_KIT);

// Exact tape-centre dimensions requested by Trent; provenance: docs/default-kit-dimensions.md.
// The CAD floor-tom remains app id tom2. The CAD tape's density label does NOT set pixel counts.
const dimensions = [
  { id: 'kick', diameterMm: 513.5, spacingMm: 94, spanMm: 282, pixelsPerHoop: 196 },
  { id: 'snare', diameterMm: 278.5, spacingMm: 182 / 3, spanMm: 182, pixelsPerHoop: 108 },
  { id: 'tom1', diameterMm: 278.5, spacingMm: 182 / 3, spanMm: 182, pixelsPerHoop: 108 },
  { id: 'tom2', diameterMm: 358.5, spacingMm: 322 / 3, spanMm: 322, pixelsPerHoop: 136 },
];

function withoutDimensions(kit: KitConfig) {
  return {
    ...kit,
    drums: kit.drums.map(({ diameterIn, hoopSpacingMm, ...rest }) => rest),
  };
}

function centroid(pixels: Pixel[]): Vec3 {
  const sum = pixels.reduce((v, p) => ({
    x: v.x + p.world.x, y: v.y + p.world.y, z: v.z + p.world.z,
  }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / pixels.length, y: sum.y / pixels.length, z: sum.z / pixels.length };
}

function expectVecClose(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Geometry can resize; stable pixel identity, angular order, UVs, zones and orientation cannot.
const pixelIdentity = ({ local, world, segmentLengthMm, ...rest }: Pixel) => rest;

describe('canonical default kit — Blender LED dimensions only', () => {
  it('preserves every other parsed field, including poses, hoops/reverse, spin and routing', () => {
    expect(withoutDimensions(DEFAULT_KIT)).toEqual(withoutDimensions(previousKit));
    expect(DEFAULT_KIT.version).toBe(CURRENT_KIT_VERSION);
    expect(migrateKit(DEFAULT_KIT)).toBe(DEFAULT_KIT);
    // Pin the old migration result explicitly, including the tilted tom (no pose rounding).
    expect(DEFAULT_KIT.drums.map((drum) => drum.origin)).toEqual([
      { x: 0, y: 340, z: 330 },
      { x: -230, y: 0, z: 740 },
      { x: -120, y: 272.18847050625476, z: 925.5950864665638 },
      { x: 360, y: 40, z: 710 },
    ]);
  });

  it.each(dimensions)('$id has the exact LED-path diameter and spacing, centred on its old world pose', (want) => {
    const drum = DEFAULT_KIT.drums.find((d) => d.id === want.id)!;
    const info = model.drumById.get(want.id)!;
    const pixels = model.pixels.filter((p) => p.drumId === want.id);
    const oldPixels = previousModel.pixels.filter((p) => p.drumId === want.id);
    expect(drum.diameterIn).toBe(want.diameterMm / 25.4);
    expect(drum.hoopSpacingMm).toBe(want.spacingMm);
    expect(info.radiusMm).toBe(want.diameterMm / 2);
    expectVecClose(centroid(pixels), centroid(oldPixels));
    expectVecClose(centroid(pixels), drum.origin);

    const hoopCentres: Vec3[] = [];
    for (let hoop = 1; hoop <= 4; hoop++) {
      const ring = pixels.filter((p) => p.hoopIndex === hoop);
      const centre = centroid(ring);
      hoopCentres.push(centre);
      expect(ring).toHaveLength(want.pixelsPerHoop);
      for (const pixel of ring) {
        expect(Math.hypot(pixel.local.x, pixel.local.y)).toBeCloseTo(want.diameterMm / 2, 9);
        expect(distance(pixel.world, centre)).toBeCloseTo(want.diameterMm / 2, 9);
        expect(pixel.local.z).toBeCloseTo((hoop - 1) * want.spacingMm - want.spanMm / 2, 9);
      }
    }
    expect(distance(hoopCentres[0]!, hoopCentres[3]!)).toBeCloseTo(want.spanMm, 9);
    for (let i = 1; i < hoopCentres.length; i++) {
      expect(distance(hoopCentres[i - 1]!, hoopCentres[i]!)).toBeCloseTo(want.spacingMm, 9);
    }
    // A resized stack moves the skin/effect origin, not the drum's centre; this is intentional.
    expectVecClose(info.effectOriginWorld, hoopCentres[0]!);
  });

  it('keeps all 2192 pixel identities and their drum/hoop/angular order', () => {
    expect(model.pixelCount).toBe(2192);
    expect(DEFAULT_KIT.drums.map((d) => d.id)).toEqual(['kick', 'snare', 'tom1', 'tom2']);
    expect(DEFAULT_KIT.drums.map((d) => d.hoops)).toEqual(dimensions.map((d) =>
      Array.from({ length: 4 }, () => ({ pixelCount: d.pixelsPerHoop, reverse: false })),
    ));
    expect(model.drums.map((d) => ({ start: d.pixelStart, count: d.pixelCount, hoops: d.hoopCount }))).toEqual([
      { start: 0, count: 784, hoops: 4 },
      { start: 784, count: 432, hoops: 4 },
      { start: 1216, count: 432, hoops: 4 },
      { start: 1648, count: 544, hoops: 4 },
    ]);
    expect(model.pixels.map(pixelIdentity)).toEqual(previousModel.pixels.map(pixelIdentity));
  });

  it('keeps the full DMX channel/universe map unchanged', () => {
    expect(buildDmxMap(DEFAULT_KIT, model)).toEqual(buildDmxMap(previousKit, previousModel));
  });

  it('uses the corrected kit in independent default projects and survives JSON round-trips', () => {
    const canonicalBytes = JSON.stringify(DEFAULT_KIT);
    const first = defaultProject();
    const second = defaultProject();
    expect(first.kit).toEqual(DEFAULT_KIT);
    expect(parseProject(JSON.parse(JSON.stringify(first)))).toEqual(first);
    first.kit.drums[0]!.diameterIn = 99;
    first.kit.drums[0]!.hoops![0]!.reverse = true;
    expect(JSON.stringify(DEFAULT_KIT)).toBe(canonicalBytes);
    expect(JSON.stringify(second.kit)).toBe(canonicalBytes);
    expect(defaultProject().kit).toEqual(second.kit);
  });
});

describe('saved kits are not replaced by corrected defaults (in-memory fixtures only)', () => {
  it.each([
    { label: 'v3 legacy', kit: legacySeed },
    { label: 'already-migrated', kit: previousKit },
  ])('retains the old dimensions and resulting geometry of a $label saved project', ({ kit }) => {
    const saved = { ...defaultProject(), kit };
    const bytes = JSON.stringify(saved);
    const restored = parseProject(saved);
    expect(JSON.stringify(saved)).toBe(bytes);
    expect(restored.kit).toEqual(previousKit);
    expect(buildPixelModel(restored.kit)).toEqual(previousModel);
    expect(parseKit(JSON.parse(JSON.stringify(restored.kit)))).toEqual(previousKit);
  });

  it('leaves an authored current-version kit with custom dimensions, poses, reverse and routing intact', () => {
    const kit = parseKit(previousKit);
    const kick = kit.drums[0]!;
    kick.diameterIn = 22.75;
    kick.hoopSpacingMm = 83.125;
    kick.origin = { x: 17, y: -23, z: 456 };
    kick.rotation = { x: -37, y: 12, z: 48 };
    kick.localSpinDeg = 123;
    kick.startAngleDeg = 17;
    kick.flip = true;
    kick.hoops = [
      { pixelCount: 11, reverse: true }, { pixelCount: 13, reverse: false },
      { pixelCount: 17, reverse: true }, { pixelCount: 19, reverse: false },
    ];
    kit.global.mirror = 'x';
    kit.global.expanded = true;
    kit.outputs = [{
      id: 'saved-run', channelsPerPixel: 3, rgbOrder: 'GRB', startUniverse: 5,
      segments: [
        { drumId: 'tom2', hoopStart: 2, hoopEnd: 4 },
        { drumId: 'kick', hoopStart: 3, hoopEnd: 4 },
        { drumId: 'kick', hoopStart: 1, hoopEnd: 2 },
      ],
    }];
    const saved = { ...defaultProject(), kit };
    const bytes = JSON.stringify(saved);
    const beforeModel = buildPixelModel(kit);
    const restored = parseProject(saved);
    expect(JSON.stringify(saved)).toBe(bytes);
    expect(restored.kit).toEqual(kit);
    const restoredModel = buildPixelModel(restored.kit);
    expect(restoredModel).toEqual(beforeModel);
    expect(buildDmxMap(restored.kit, restoredModel)).toEqual(buildDmxMap(kit, beforeModel));
  });
});
