import { describe, expect, it } from 'vitest';
import { CURRENT_KIT_VERSION, migrateKit, parseKit } from './kit-schema';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

// A1: hoop indexing is canonicalized to 1-based. A pre-A1 project stored 0-based hoop
// ranges (schema version 1); the migrator shifts them +1 and stamps version 2, and the
// resulting DMX output is byte-identical — the migration is a pure relabel, not a re-patch.

const drumsRaw = [
  { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 12, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
  { id: 'B', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 2, pixelsPerHoop: 8, origin: { x: 500, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
];
const global = { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 };

/** Version-1 (pre-A1) kit with 0-based hoop ranges. */
const v1Raw = {
  version: 1,
  global,
  drums: drumsRaw,
  outputs: [
    { id: 'o1', channelsPerPixel: 3, dataLines: [
      { id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 3 }] },
      { id: 'o1:dl1', segments: [{ drumId: 'B', hoopStart: 0, hoopEnd: 1 }] },
    ] },
  ],
};

/** The same physical wiring authored natively 1-based at version 2 (post-A1, pre-B2). */
const v2Raw = {
  version: 2,
  global,
  drums: drumsRaw,
  outputs: [
    { id: 'o1', channelsPerPixel: 3, dataLines: [
      { id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] },
      { id: 'o1:dl1', segments: [{ drumId: 'B', hoopStart: 1, hoopEnd: 2 }] },
    ] },
  ],
};

/** A kit already at the CURRENT version (no migration owed) — used for the by-reference
 *  idempotence check, which must survive future version bumps. */
const currentRaw = { ...v2Raw, version: CURRENT_KIT_VERSION, global: { ...global, expanded: false } };

describe('migrateKit — 0-based → 1-based hoop indexing (A1)', () => {
  it('shifts every segment +1 and stamps the current version', () => {
    const migrated = migrateKit(v1Raw) as typeof v2Raw;
    expect(migrated.version).toBe(CURRENT_KIT_VERSION);
    const dl0 = migrated.outputs[0]!.dataLines[0]!.segments[0]!;
    const dl1 = migrated.outputs[0]!.dataLines[1]!.segments[0]!;
    expect(dl0).toEqual({ drumId: 'A', hoopStart: 1, hoopEnd: 4 });
    expect(dl1).toEqual({ drumId: 'B', hoopStart: 1, hoopEnd: 2 });
  });

  it('is idempotent — a current-version kit is returned untouched', () => {
    expect(migrateKit(currentRaw)).toBe(currentRaw);
    // and migrating an already-migrated kit does not shift again
    const once = migrateKit(v1Raw);
    expect(migrateKit(once)).toEqual(once);
  });

  it('migrates the legacy bare-`segments` output shape too', () => {
    const legacy = {
      version: 1,
      global,
      drums: drumsRaw,
      outputs: [{ id: 'o1', channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 3 }] }],
    };
    const migrated = migrateKit(legacy) as { outputs: Array<{ segments: Array<{ hoopStart: number; hoopEnd: number }> }> };
    expect(migrated.outputs[0]!.segments[0]).toEqual({ drumId: 'A', hoopStart: 1, hoopEnd: 4 });
  });

  it('a version-absent kit is treated as legacy (0-based) and migrated', () => {
    const noVersion = { global, drums: drumsRaw, outputs: v1Raw.outputs };
    const migrated = migrateKit(noVersion) as typeof v2Raw;
    expect(migrated.version).toBe(CURRENT_KIT_VERSION);
    expect(migrated.outputs[0]!.dataLines[0]!.segments[0]!.hoopStart).toBe(1);
  });
});

describe('golden DMX parity across the migration (byte-identical)', () => {
  it('a migrated v1 kit produces the same DMX map as the native 1-based kit', () => {
    const fromV1 = parseKit(v1Raw); // migrated on parse
    const fromV2 = parseKit(v2Raw);
    const mapV1 = buildDmxMap(fromV1, buildPixelModel(fromV1));
    const mapV2 = buildDmxMap(fromV2, buildPixelModel(fromV2));
    expect(mapV1.perPixel).toEqual(mapV2.perPixel);
    expect(mapV1.universes).toEqual(mapV2.universes);
  });

  it('parseKit stamps the current version on a migrated kit', () => {
    expect(parseKit(v1Raw).version).toBe(CURRENT_KIT_VERSION);
  });
});
