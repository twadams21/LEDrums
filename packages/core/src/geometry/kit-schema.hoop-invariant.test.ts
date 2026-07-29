import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { CURRENT_KIT_VERSION } from './kit-migrations';

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

  it('a uniform drum (pixelsPerHoop + hoopCount, no hoops[]) satisfies the invariant', () => {
    // A drum that declares no `hoops[]` can never trip the refine — the pair it compares does
    // not exist. (This used to arrive via the v4→v5 expander, deleted with the v7 floor.)
    expect(() =>
      parseKit({
        version: CURRENT_KIT_VERSION,
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
