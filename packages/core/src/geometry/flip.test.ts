import { describe, expect, it } from 'vitest';
import { parseKit, type KitConfig } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

/* S10 golden suite — per-drum flip is a GEOMETRY-ONLY transform. It reflects the drum
   along its local Z (skins swap) and negates the angular sweep (chase/wind direction),
   but leaves pixel INDEX order, hoop indices, and the DMX byte stream untouched: a flip
   never re-patches hardware. Byte-exact literal pixel counts keep the goldens exact.
   S11 (kit mirror) mirrors this file: it composes a FINAL world-space reflection on top,
   under the same "positions change, dmxMap does not" invariant. */

function kit(flip: boolean, overrides: Record<string, unknown> = {}): KitConfig {
  return parseKit({
    global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 10000 },
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
        flip,
        ...overrides,
      },
    ],
    // A real single-output topology so the DMX map is a meaningful byte-exact golden.
    outputs: [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'kick', hoopStart: 0, hoopEnd: 3 }] }] }],
  });
}

const normal = () => buildPixelModel(kit(false));
const flipped = () => buildPixelModel(kit(true));

describe('flip — geometry-only reflection (S10)', () => {
  it('flip twice = identity: the reflection (x, -y, -z at base angle 0) is its own inverse', () => {
    // With startAngle=spin=0 the flip negates the angular sweep → mirrors local Y, and
    // reflects local Z. Negating Y and Z a second time recovers the unflipped position
    // byte-for-byte, so applying flip twice is the identity.
    const n = normal();
    const f = flipped();
    for (let i = 0; i < n.pixels.length; i++) {
      const np = n.pixels[i]!;
      const fp = f.pixels[i]!;
      expect(fp.local.x).toBeCloseTo(np.local.x, 9);
      expect(fp.local.y).toBeCloseTo(-np.local.y, 9);
      expect(fp.local.z).toBe(-np.local.z);
      // reflect the flipped pixel back → the original (double-flip identity).
      expect(-fp.local.z).toBe(np.local.z);
      expect(-fp.local.y).toBeCloseTo(np.local.y, 9);
    }
  });

  it('preserves pixel count and index order (id / drum / hoop / indexInHoop unchanged)', () => {
    const n = normal();
    const f = flipped();
    expect(f.pixelCount).toBe(n.pixelCount);
    expect(f.pixels).toHaveLength(n.pixels.length);
    for (let i = 0; i < n.pixels.length; i++) {
      const np = n.pixels[i]!;
      const fp = f.pixels[i]!;
      expect(fp.id).toBe(np.id);
      expect(fp.drumId).toBe(np.drumId);
      expect(fp.hoopIndex).toBe(np.hoopIndex);
      expect(fp.indexInHoop).toBe(np.indexInHoop);
    }
  });

  it('leaves the DMX map byte-identical with flip on/off (never re-patches hardware)', () => {
    const kn = kit(false);
    const kf = kit(true);
    const mapN = buildDmxMap(kn, buildPixelModel(kn));
    const mapF = buildDmxMap(kf, buildPixelModel(kf));
    // Every per-pixel channel assignment and every universe patch is identical.
    expect(mapF.perPixel).toEqual(mapN.perPixel);
    expect(mapF.universes).toEqual(mapN.universes);
  });

  it('swaps skins: the hoop stack reflects along local Z (hoop N-1 flips sign, stack inverts)', () => {
    const n = normal();
    const f = flipped();
    const hoopZ = (m: ReturnType<typeof buildPixelModel>, h: number) =>
      m.pixels.find((p) => p.hoopIndex === h)!.local.z;
    const top = 3; // hoopCount - 1
    // Normal: hoop 0 at the origin plane, top hoop up at +150mm.
    expect(hoopZ(n, 0)).toBe(0);
    expect(hoopZ(n, top)).toBe(150);
    // Flipped: the top skin reflects to -150mm — the stack now runs the other way.
    expect(hoopZ(f, top)).toBe(-hoopZ(n, top));
    expect(hoopZ(f, top)).toBeLessThan(hoopZ(f, 0));
  });

  it('reverses wind direction: the angular sweep between consecutive pixels flips sign', () => {
    const n = normal();
    const f = flipped();
    // Signed shortest step from pixel 0 → pixel 1 (both share the base angle at pixel 0).
    const signedStep = (a0: number, a1: number) => (((a1 - a0 + 540) % 360) - 180);
    expect(f.pixels[0]!.angleDeg).toBeCloseTo(n.pixels[0]!.angleDeg, 9);
    const nStep = signedStep(n.pixels[0]!.angleDeg, n.pixels[1]!.angleDeg);
    const fStep = signedStep(f.pixels[0]!.angleDeg, f.pixels[1]!.angleDeg);
    expect(nStep).toBeCloseTo(45, 9); // 360 / 8
    expect(fStep).toBeCloseTo(-45, 9); // reversed
  });
});
