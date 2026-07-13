import { describe, expect, it } from 'vitest';
import {
  CURRENT_KIT_VERSION,
  PIXLITE_PHYSICAL_OUTPUTS,
  logicalOutputCount,
  logicalOutputsForPhysical,
  migrateKit,
  parseKit,
  type KitConfig,
} from './kit-schema';

// B2: the Advatek `expanded` output flag. New kits default OFF (4 physical outputs);
// projects predating the flag (kit version < 3) migrate to ON (8 logical outputs) so an
// established rig keeps its expanded wiring. The flag lives on `kit.global` (hardware
// config beside `maxPixelsPerOutput`), NOT on the network-adoption `controller` record.

const global = { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 };
const drums = [
  { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 12, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
];
const outputs = [
  { id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] }] },
];

/** A pre-B2 kit authored at version 2 (post-A1) with no `expanded` field. */
const v2Raw = { version: 2, global, drums, outputs };
/** A pre-A1 kit (version 1, 0-based hoop ranges, no `expanded`). */
const v1Raw = { version: 1, global, drums, outputs: [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 3 }] }] }] };

describe('B2 expanded flag — defaults', () => {
  it('a NEW kit (no expanded field, current version) defaults expanded OFF', () => {
    const kit = parseKit({ version: CURRENT_KIT_VERSION, global, drums, outputs });
    expect(kit.global.expanded).toBe(false);
  });

  it('an explicit expanded:true on a current-version kit is preserved', () => {
    const kit = parseKit({ version: CURRENT_KIT_VERSION, global: { ...global, expanded: true }, drums, outputs });
    expect(kit.global.expanded).toBe(true);
  });
});

describe('B2 expanded flag — migration (existing → ON)', () => {
  it('migrates a version-2 kit to expanded ON and stamps the current version', () => {
    const migrated = migrateKit(v2Raw) as { version: number; global: { expanded?: boolean } };
    expect(migrated.version).toBe(CURRENT_KIT_VERSION);
    expect(migrated.global.expanded).toBe(true);
  });

  it('migrates a pre-A1 version-1 kit to expanded ON *and* shifts hoops (cumulative)', () => {
    const kit = parseKit(v1Raw);
    expect(kit.version).toBe(CURRENT_KIT_VERSION);
    expect(kit.global.expanded).toBe(true);
    // A1 step still ran: the 0-based [0..3] range became 1-based [1..4].
    expect(kit.outputs[0]!.dataLines[0]!.segments[0]).toEqual({ drumId: 'A', hoopStart: 1, hoopEnd: 4 });
  });

  it('respects an explicit expanded value on a pre-B2 kit (does not force ON)', () => {
    const migrated = migrateKit({ version: 2, global: { ...global, expanded: false }, drums, outputs }) as { global: { expanded?: boolean } };
    expect(migrated.global.expanded).toBe(false);
  });

  it('round-trips: migrate → parse → serialize → parse is stable at ON', () => {
    const once = parseKit(v2Raw);
    const round = parseKit(JSON.parse(JSON.stringify(once)));
    expect(round).toEqual(once);
    expect(round.version).toBe(CURRENT_KIT_VERSION);
    expect(round.global.expanded).toBe(true);
  });

  it('migration is a pure relabel — geometry (drums/outputs) is untouched', () => {
    const before = JSON.parse(JSON.stringify(v2Raw));
    const kit = parseKit(v2Raw);
    // outputs + drums survive the migration byte-for-byte (only version + expanded change).
    expect(kit.outputs).toEqual(before.outputs);
    expect(kit.drums.map((d: KitConfig['drums'][number]) => d.id)).toEqual(['A']);
  });
});

describe('B2 logical output mapping (2n-1 / 2n)', () => {
  const kitWith = (expanded: boolean): KitConfig =>
    parseKit({ version: CURRENT_KIT_VERSION, global: { ...global, expanded }, drums, outputs });

  it('exposes 4 logical outputs when normal, 8 when expanded', () => {
    expect(logicalOutputCount(kitWith(false))).toBe(PIXLITE_PHYSICAL_OUTPUTS);
    expect(logicalOutputCount(kitWith(true))).toBe(PIXLITE_PHYSICAL_OUTPUTS * 2);
    expect(logicalOutputCount(kitWith(false))).toBe(4);
    expect(logicalOutputCount(kitWith(true))).toBe(8);
  });

  it('maps physical port n → [2n-1, 2n] when expanded', () => {
    expect(logicalOutputsForPhysical(1, true)).toEqual([1, 2]);
    expect(logicalOutputsForPhysical(2, true)).toEqual([3, 4]);
    expect(logicalOutputsForPhysical(3, true)).toEqual([5, 6]);
    expect(logicalOutputsForPhysical(4, true)).toEqual([7, 8]);
  });

  it('maps physical port n → [n] when normal', () => {
    for (let n = 1; n <= PIXLITE_PHYSICAL_OUTPUTS; n++) {
      expect(logicalOutputsForPhysical(n, false)).toEqual([n]);
    }
  });

  it('the expanded mapping covers exactly the 8 logical outputs, no gaps or overlaps', () => {
    const all = [1, 2, 3, 4].flatMap((n) => logicalOutputsForPhysical(n, true));
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
