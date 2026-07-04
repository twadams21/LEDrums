import { describe, expect, it } from 'vitest';
import { parseKit, type KitConfig } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

/* S11 golden suite — kit-global mirror is a GEOMETRY-ONLY final WORLD-space reflection. It
   negates world X ('x') or world Y ('y') for EVERY pixel (positions + tangents/normals), but
   leaves pixel INDEX order, hoop indices, and the DMX byte stream untouched: a mirror never
   re-patches hardware. It composes cleanly on top of S10's per-drum flip (baked into
   local→world). Byte-exact literal pixel counts keep the goldens exact. Mirrors flip.test.ts
   under the same "positions change, dmxMap does not" invariant, plus a mirror∘flip compose. */

function kit(
  mirror: 'none' | 'x' | 'y',
  flip = false,
  overrides: Record<string, unknown> = {},
): KitConfig {
  return parseKit({
    global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 10000, mirror },
    drums: [
      {
        id: 'kick',
        // Off-origin + rotated so a world reflection is a non-trivial, observable transform.
        diameterIn: 12,
        hoopSpacingMm: 50,
        hoopCount: 4,
        pixelsPerHoop: 8,
        localSpinDeg: 0,
        startAngleDeg: 0,
        origin: { x: 100, y: 40, z: 0 },
        rotation: { x: 0, y: 0, z: 30 },
        flip,
        ...overrides,
      },
    ],
    // A real single-output topology so the DMX map is a meaningful byte-exact golden.
    outputs: [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'kick', hoopStart: 0, hoopEnd: 3 }] }] }],
  });
}

const none = () => buildPixelModel(kit('none'));
const mirX = () => buildPixelModel(kit('x'));
const mirY = () => buildPixelModel(kit('y'));

describe('kit mirror — geometry-only world reflection (S11)', () => {
  it("mirror 'x' negates world X on every pixel; Y/Z untouched (positions reflect)", () => {
    const n = none();
    const m = mirX();
    for (let i = 0; i < n.pixels.length; i++) {
      const np = n.pixels[i]!;
      const mp = m.pixels[i]!;
      expect(mp.world.x).toBeCloseTo(-np.world.x, 9);
      expect(mp.world.y).toBeCloseTo(np.world.y, 9);
      expect(mp.world.z).toBeCloseTo(np.world.z, 9);
    }
  });

  it("mirror 'y' negates world Y on every pixel; X/Z untouched", () => {
    const n = none();
    const m = mirY();
    for (let i = 0; i < n.pixels.length; i++) {
      const np = n.pixels[i]!;
      const mp = m.pixels[i]!;
      expect(mp.world.x).toBeCloseTo(np.world.x, 9);
      expect(mp.world.y).toBeCloseTo(-np.world.y, 9);
      expect(mp.world.z).toBeCloseTo(np.world.z, 9);
    }
  });

  it('reflects tangent + normal + effect origin identically (orientation stays consistent)', () => {
    const n = none();
    const m = mirX();
    for (let i = 0; i < n.pixels.length; i++) {
      expect(m.pixels[i]!.tangent.x).toBeCloseTo(-n.pixels[i]!.tangent.x, 9);
      expect(m.pixels[i]!.tangent.y).toBeCloseTo(n.pixels[i]!.tangent.y, 9);
      expect(m.pixels[i]!.normal.x).toBeCloseTo(-n.pixels[i]!.normal.x, 9);
      expect(m.pixels[i]!.normal.y).toBeCloseTo(n.pixels[i]!.normal.y, 9);
    }
    expect(m.drums[0]!.effectOriginWorld.x).toBeCloseTo(-n.drums[0]!.effectOriginWorld.x, 9);
    expect(m.drums[0]!.effectOriginWorld.y).toBeCloseTo(n.drums[0]!.effectOriginWorld.y, 9);
  });

  it('is an involution: mirroring the same axis twice recovers the original world coords', () => {
    // The model has no double-mirror config, so verify algebraically: reflecting m's world X
    // back yields n's world X byte-for-byte (negation is its own inverse).
    const n = none();
    const m = mirX();
    for (let i = 0; i < n.pixels.length; i++) {
      expect(-m.pixels[i]!.world.x).toBeCloseTo(n.pixels[i]!.world.x, 9);
    }
  });

  it('preserves pixel count and index order (id / drum / hoop / indexInHoop unchanged)', () => {
    const n = none();
    const m = mirX();
    expect(m.pixelCount).toBe(n.pixelCount);
    for (let i = 0; i < n.pixels.length; i++) {
      expect(m.pixels[i]!.id).toBe(n.pixels[i]!.id);
      expect(m.pixels[i]!.drumId).toBe(n.pixels[i]!.drumId);
      expect(m.pixels[i]!.hoopIndex).toBe(n.pixels[i]!.hoopIndex);
      expect(m.pixels[i]!.indexInHoop).toBe(n.pixels[i]!.indexInHoop);
    }
  });

  it('leaves the DMX map byte-identical regardless of mirror (never re-patches hardware)', () => {
    const kn = kit('none');
    const kx = kit('x');
    const ky = kit('y');
    const mapN = buildDmxMap(kn, buildPixelModel(kn));
    const mapX = buildDmxMap(kx, buildPixelModel(kx));
    const mapY = buildDmxMap(ky, buildPixelModel(ky));
    expect(mapX.perPixel).toEqual(mapN.perPixel);
    expect(mapX.universes).toEqual(mapN.universes);
    expect(mapY.perPixel).toEqual(mapN.perPixel);
    expect(mapY.universes).toEqual(mapN.universes);
  });

  it('composes with flip: mirror ∘ flip = the flipped world coords reflected, dmxMap still golden', () => {
    // The mirror is a FINAL world reflection AFTER flip's local→world bake, so mirror(flip(p))
    // world == reflect(flip(p) world). Verify both goldens: world coords agree, DMX bytes hold.
    const flipOnly = buildPixelModel(kit('none', true));
    const flipThenMirror = buildPixelModel(kit('x', true));
    for (let i = 0; i < flipOnly.pixels.length; i++) {
      expect(flipThenMirror.pixels[i]!.world.x).toBeCloseTo(-flipOnly.pixels[i]!.world.x, 9);
      expect(flipThenMirror.pixels[i]!.world.y).toBeCloseTo(flipOnly.pixels[i]!.world.y, 9);
      expect(flipThenMirror.pixels[i]!.world.z).toBeCloseTo(flipOnly.pixels[i]!.world.z, 9);
    }
    // DMX map identical across flip-only vs flip+mirror — both geometry-only transforms.
    const kf = kit('none', true);
    const kfm = kit('x', true);
    const mapF = buildDmxMap(kf, buildPixelModel(kf));
    const mapFM = buildDmxMap(kfm, buildPixelModel(kfm));
    expect(mapFM.perPixel).toEqual(mapF.perPixel);
    expect(mapFM.universes).toEqual(mapF.universes);
  });
});
