import { describe, expect, it } from 'vitest';
import {
  CURRENT_KIT_VERSION,
  drumHoopCount,
  migrateKit,
  parseKit,
  type HoopConfig,
  type KitConfig,
} from './kit-schema';
import { buildPixelModel, getHoopPixelRange, type Pixel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

/* B4 golden suite — hoops are FIRST-CLASS: `DrumConfig.hoops: HoopConfig[]`, each hoop its own
   `pixelCount` (hoops on one drum MAY differ) + `reverse` (flip the pixel index→position mapping
   within that hoop only, for a backward-wired strip). The v<5 migrator expands a legacy uniform
   `pixelsPerHoop` into an explicit `hoops[]`; reverse:false ⇒ byte-identical output (parity). */

/** Single-drum kit at CURRENT version. `hoops` (when given) is authoritative; otherwise the drum
    resolves the legacy uniform way from `pixelsPerHoop`/`hoopCount`. */
function kit(drum: Record<string, unknown>, global: Record<string, unknown> = {}): KitConfig {
  return parseKit({
    version: CURRENT_KIT_VERSION,
    global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000, ...global },
    drums: [
      {
        id: 'kick',
        diameterIn: 12,
        hoopSpacingMm: 50,
        localSpinDeg: 0,
        startAngleDeg: 0,
        origin: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        ...drum,
      },
    ],
  });
}

/** A drum's pixels for one hoop, in emission (id) order. hoop is 1-based. */
const hoopPixels = (pixels: Pixel[], hoop: number): Pixel[] =>
  pixels.filter((p) => p.hoopIndex === hoop).sort((a, b) => a.id - b.id);

const hoop = (pixelCount: number, reverse = false): HoopConfig => ({ pixelCount, reverse });

// One physical output covering every hoop of `kick`, dense from universe 0 (3 ch/pixel).
const outputFor = (hoopEnd: number) => [
  { id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd }] }] },
];

describe('B4 — per-hoop pixel counts (hoops within a drum may differ)', () => {
  const mixed = kit({ hoops: [hoop(8), hoop(12), hoop(4)] });
  const model = buildPixelModel(mixed);

  it('the drum reports per-hoop counts and their sum, hoopCount = hoops.length', () => {
    const d = model.drumById.get('kick')!;
    expect(d.hoopCount).toBe(3);
    expect(d.hoopPixelCounts).toEqual([8, 12, 4]);
    expect(d.pixelCount).toBe(24);
    // `pixelsPerHoop` back-compat = first hoop's count.
    expect(d.pixelsPerHoop).toBe(8);
  });

  it('each hoop emits exactly its own pixel count', () => {
    expect(hoopPixels(model.pixels, 1)).toHaveLength(8);
    expect(hoopPixels(model.pixels, 2)).toHaveLength(12);
    expect(hoopPixels(model.pixels, 3)).toHaveLength(4);
  });

  it('getHoopPixelRange walks the prefix sum, not a uniform stride', () => {
    expect(getHoopPixelRange(model, 'kick', 1)).toEqual({ start: 0, end: 8 });
    expect(getHoopPixelRange(model, 'kick', 2)).toEqual({ start: 8, end: 20 });
    expect(getHoopPixelRange(model, 'kick', 3)).toEqual({ start: 20, end: 24 });
    expect(getHoopPixelRange(model, 'kick', 4)).toBeNull();
  });

  it('the DMX map packs mixed hoops contiguously (24 px × 3 ch = 72 channels)', () => {
    const map = buildDmxMap(mixed, model);
    // Every pixel patched, dense: pixel id i → channel 3i.
    for (let id = 0; id < 24; id++) expect(map.perPixel[id]).toEqual({ channel: id * 3 });
    // 72 channels fit in universe 0.
    expect(map.universes).toHaveLength(1);
    expect(map.universes[0]!.channelCount).toBe(72);
    expect(map.universes[0]!.pixels).toHaveLength(24);
  });
});

describe('B4 — per-hoop reverse flips within that hoop ONLY', () => {
  // Two 6-pixel hoops; reverse only hoop 2. spin/start 0 ⇒ normal angles are 0,60,…,300.
  const normal = buildPixelModel(kit({ hoops: [hoop(6), hoop(6)] }));
  const reversed = buildPixelModel(kit({ hoops: [hoop(6), hoop(6, true)] }));

  const angles = (m: typeof normal, h: number) => hoopPixels(m.pixels, h).map((p) => p.angleDeg);

  it('hoop 1 (not reversed) is untouched', () => {
    expect(angles(reversed, 1)).toEqual(angles(normal, 1));
    expect(angles(normal, 1)).toEqual([0, 60, 120, 180, 240, 300]);
  });

  it('hoop 2 angular positions are emitted in reverse index order', () => {
    // Emission slot i now maps to angular position n-1-i: the sequence reverses.
    expect(angles(reversed, 2)).toEqual([...angles(normal, 2)].reverse());
  });

  it('pixel ids / indexInHoop stay contiguous and ascending (only geometry flips)', () => {
    const ids = hoopPixels(reversed.pixels, 2).map((p) => p.id);
    const idx = hoopPixels(reversed.pixels, 2).map((p) => p.indexInHoop);
    expect(ids).toEqual([6, 7, 8, 9, 10, 11]);
    expect(idx).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reverse changes geometry, NOT the DMX channel map (channel is per id)', () => {
    const normalKit = { ...kit({ hoops: [hoop(6), hoop(6)] }), outputs: outputFor(2) };
    const reversedKit = { ...kit({ hoops: [hoop(6), hoop(6, true)] }), outputs: outputFor(2) };
    const mapNormal = buildDmxMap(normalKit, buildPixelModel(normalKit));
    const mapReversed = buildDmxMap(reversedKit, buildPixelModel(reversedKit));
    expect(mapReversed.perPixel).toEqual(mapNormal.perPixel);
  });
});

describe('B4 — migration expands uniform pixelsPerHoop into first-class hoops[]', () => {
  // A post-B3, pre-B4 kit (version 4): uniform literal count, no `hoops`.
  const legacyGlobal = { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000, expanded: false };
  const legacyDrum = {
    id: 'kick',
    diameterIn: 12,
    hoopSpacingMm: 50,
    hoopCount: 4,
    pixelsPerHoop: 9,
    localSpinDeg: 0,
    startAngleDeg: 0,
    origin: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const legacyRaw = { version: 4, global: legacyGlobal, drums: [legacyDrum], outputs: [] };

  it('a literal-count drum gains hoops[] of length hoopCount, each count + reverse:false', () => {
    const migrated = migrateKit(legacyRaw) as { version: number; drums: Array<{ hoops?: HoopConfig[] }> };
    expect(migrated.version).toBe(CURRENT_KIT_VERSION);
    expect(migrated.drums[0]!.hoops).toEqual([
      { pixelCount: 9, reverse: false },
      { pixelCount: 9, reverse: false },
      { pixelCount: 9, reverse: false },
      { pixelCount: 9, reverse: false },
    ]);
  });

  it('hoop count falls back to the kit global when the drum omits its own', () => {
    const noPerDrum = { ...legacyRaw, global: { ...legacyGlobal, hoopCount: 3 }, drums: [{ ...legacyDrum, hoopCount: undefined }] };
    const migrated = migrateKit(noPerDrum) as { drums: Array<{ hoops?: HoopConfig[] }> };
    expect(migrated.drums[0]!.hoops).toHaveLength(3);
  });

  it('a density-derived drum (no literal count) keeps hoops absent — density still tracks', () => {
    const density = { version: 4, global: legacyGlobal, drums: [{ ...legacyDrum, pixelsPerHoop: undefined }], outputs: [] };
    const migrated = migrateKit(density) as { drums: Array<{ hoops?: HoopConfig[] }> };
    expect(migrated.drums[0]!.hoops).toBeUndefined();
  });

  it('is cumulative from v1: A1 hoop-shift + B2 expanded + B3 origin + B4 hoops all applied', () => {
    const v1 = {
      version: 1,
      global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000 },
      drums: [legacyDrum],
      outputs: [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'kick', hoopStart: 0, hoopEnd: 3 }] }] }],
    };
    const parsed = parseKit(v1);
    expect(parsed.version).toBe(CURRENT_KIT_VERSION);
    expect(parsed.global.expanded).toBe(true); // B2
    expect(parsed.outputs[0]!.dataLines[0]!.segments[0]).toMatchObject({ hoopStart: 1, hoopEnd: 4 }); // A1
    expect(parsed.drums[0]!.hoops).toHaveLength(4); // B4
    expect(parsed.drums[0]!.hoops!.every((h) => h.pixelCount === 9 && h.reverse === false)).toBe(true);
  });

  it('is idempotent — a current-version kit is returned untouched, double-migrate is stable', () => {
    const current = { ...legacyRaw, version: CURRENT_KIT_VERSION };
    expect(migrateKit(current)).toBe(current);
    const once = migrateKit(legacyRaw);
    expect(migrateKit(once)).toEqual(once);
  });
});

describe('B4 — parity: reverse:false hoops[] === the legacy uniform path (byte-identical)', () => {
  // Same geometry, two spellings: explicit uniform hoops[] vs legacy pixelsPerHoop.
  const viaHoops = kit({ hoops: [hoop(8), hoop(8), hoop(8), hoop(8)] });
  const viaLegacy = kit({ hoopCount: 4, pixelsPerHoop: 8 });

  it('every pixel world position + angle matches', () => {
    const a = buildPixelModel(viaHoops).pixels;
    const b = buildPixelModel(viaLegacy).pixels;
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.world).toEqual(b[i]!.world);
      expect(a[i]!.angleDeg).toEqual(b[i]!.angleDeg);
      expect(a[i]!.indexInHoop).toEqual(b[i]!.indexInHoop);
    }
  });

  it('the DMX byte map is identical', () => {
    const mh = buildDmxMap({ ...viaHoops, outputs: outputFor(4) }, buildPixelModel({ ...viaHoops, outputs: outputFor(4) }));
    const ml = buildDmxMap({ ...viaLegacy, outputs: outputFor(4) }, buildPixelModel({ ...viaLegacy, outputs: outputFor(4) }));
    expect(mh.perPixel).toEqual(ml.perPixel);
    expect(mh.universes).toEqual(ml.universes);
  });

  it('a migrated legacy kit renders identically to its pre-migration self', () => {
    const rawLegacy = {
      version: 4,
      global: { ledDensityPxPerM: 60, hoopCount: 4, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 100000, expanded: false },
      drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 8, localSpinDeg: 0, startAngleDeg: 0, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
      outputs: outputFor(4),
    };
    const migrated = parseKit(rawLegacy); // gains hoops[]
    expect(migrated.drums[0]!.hoops).toHaveLength(4);
    const model = buildPixelModel(migrated);
    // Same 32 pixels, dense DMX from channel 0 — nothing moved.
    expect(model.pixelCount).toBe(32);
    const map = buildDmxMap(migrated, model);
    for (let id = 0; id < 32; id++) expect(map.perPixel[id]).toEqual({ channel: id * 3 });
  });
});

/* Track-review regression (2026-07-13): `drumHoopCount` MUST honour B4's authoritative
   `hoops.length`, so the routing accept/reject gate + coverage warning agree with the pixel model
   / buildDmxMap for a first-class drum whose hoops[] diverges from hoopCount/global. Before the
   fix the helper returned `hoopCount ?? global`, so the gate accepted a routing buildDmxMap threw
   on (and falsely rejected a valid one). */
describe('drumHoopCount — hoops[] is authoritative (track-review regression)', () => {
  it('returns hoops.length when it diverges from global (fewer hoops)', () => {
    const k = kit({ hoops: [hoop(30), hoop(30), hoop(30)] }, { hoopCount: 4 });
    expect(drumHoopCount(k, k.drums[0]!)).toBe(3);
    // and it agrees with the pixel model, which is the authority buildDmxMap range-checks.
    expect(buildPixelModel(k).drumById.get('kick')!.hoopCount).toBe(3);
  });

  it('returns hoops.length when it diverges (more hoops than global)', () => {
    const k = kit({ hoops: [hoop(10), hoop(10), hoop(10), hoop(10), hoop(10)] }, { hoopCount: 4 });
    expect(drumHoopCount(k, k.drums[0]!)).toBe(5);
    expect(buildPixelModel(k).drumById.get('kick')!.hoopCount).toBe(5);
  });

  it('falls back to hoopCount/global when hoops[] is absent (unchanged legacy behaviour)', () => {
    const k = kit({ pixelsPerHoop: 8 }, { hoopCount: 4 });
    expect(k.drums[0]!.hoops).toBeUndefined();
    expect(drumHoopCount(k, k.drums[0]!)).toBe(4);
  });
});
