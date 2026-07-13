import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';

/* (b) A drum may carry the legacy `hoopCount`, a first-class `hoops[]`, both, or neither — but when
   BOTH are present they must AGREE (`hoopCount === hoops.length`). A divergent pair is a latent
   stored inconsistency (resolution is unambiguous — `hoops.length` wins — but the data lies), so the
   schema rejects it. Validation only: this never resizes `hoops[]` nor rewrites `hoopCount`. */

/** A version-7 (current) kit with one drum, overridden per case. v7 skips migration so the drum's
 *  raw `hoops`/`hoopCount` reach `drumSchema` verbatim — exactly what the invariant guards. */
function kitWithDrum(over: Record<string, unknown>) {
  return {
    version: 7,
    global: { ledDensityPxPerM: 100, hoopCount: 4, defaultHoopSpacingMm: 50 },
    drums: [
      {
        id: 'A',
        diameterIn: 6,
        hoopSpacingMm: 50,
        origin: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        ...over,
      },
    ],
    outputs: [],
  };
}

describe('drumSchema hoops.length ↔ hoopCount invariant (b)', () => {
  it('accepts a drum with hoops[] only (no hoopCount)', () => {
    expect(() =>
      parseKit(kitWithDrum({ hoops: [{ pixelCount: 10 }, { pixelCount: 10 }] })),
    ).not.toThrow();
  });

  it('accepts a drum with hoopCount only (no hoops)', () => {
    expect(() => parseKit(kitWithDrum({ hoopCount: 3, pixelsPerHoop: 10 }))).not.toThrow();
  });

  it('accepts a drum with neither hoops nor hoopCount (resolves via density/global)', () => {
    expect(() => parseKit(kitWithDrum({ pixelsPerHoop: 10 }))).not.toThrow();
  });

  it('accepts matching hoops[] + hoopCount', () => {
    expect(() =>
      parseKit(kitWithDrum({ hoopCount: 2, hoops: [{ pixelCount: 10 }, { pixelCount: 10 }] })),
    ).not.toThrow();
  });

  it('rejects divergent hoops[] + hoopCount', () => {
    expect(() =>
      parseKit(kitWithDrum({ hoopCount: 5, hoops: [{ pixelCount: 10 }, { pixelCount: 10 }] })),
    ).toThrow(/hoopCount .* must equal hoops\.length/);
  });

  it('a migrated legacy drum (uniform pixelsPerHoop expanded to hoops[]) satisfies the invariant', () => {
    // The v4 → v5 migrator expands `pixelsPerHoop` into a `hoops[]` of length `hoopCount` while
    // keeping `hoopCount` — so they match by construction and never trip the new refine.
    expect(() =>
      parseKit({
        version: 4,
        global: { ledDensityPxPerM: 100, hoopCount: 4, defaultHoopSpacingMm: 50 },
        drums: [
          {
            id: 'A',
            diameterIn: 6,
            hoopSpacingMm: 50,
            hoopCount: 3,
            pixelsPerHoop: 10,
            origin: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
          },
        ],
        outputs: [],
      }),
    ).not.toThrow();
  });
});
