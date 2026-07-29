import { describe, expect, it } from 'vitest';
import {
  parseKit,
  type KitConfig,
} from './kit-schema';
import {
  PIXLITE_PHYSICAL_OUTPUTS,
  logicalOutputCount,
  logicalOutputsForPhysical,
} from './kit-queries';
import { CURRENT_KIT_VERSION } from './kit-migrations';

// B2: the Advatek `expanded` output flag. A kit declares it on `kit.global` (hardware config
// beside `maxPixelsPerOutput`), NOT on the network-adoption `controller` record. New kits
// default OFF (4 physical outputs); ON exposes 8 logical outputs, two per physical port.
// (Kits predating the flag were migrated to ON; that rung died with the v7 floor — a v<3 file
// is now rejected at load, so there is nothing left to migrate here.)

const global = { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 };
const drums = [
  { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 12, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
];
const outputs = [
  { id: 'o1', channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] },
];

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
