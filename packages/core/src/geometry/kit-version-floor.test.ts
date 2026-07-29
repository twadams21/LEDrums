import { describe, expect, it } from 'vitest';
import { parseKit } from './kit-schema';
import { CURRENT_KIT_VERSION, assertKitVersion } from './kit-migrations';
import { parseProject, parseProjectPatch } from '../model/project-schema';

/* Decision 6 (2026-07-29): the cumulative v1→v7 migration ladder was DELETED and replaced by a
   v7 FLOOR — a pre-v7 kit is REJECTED at load rather than transformed. Every kit that exists (the
   live project plus every backup) is at v7, so no rung was reachable, and a wrong migration
   silently corrupts a saved kit. These are the tests that used to prove the ladder; they now prove
   the floor: what is rejected, what passes through untouched, and where the rejection surfaces. */

const global = { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 };
const drums = [
  { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 12, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
];
/** A kit authored natively at the current version (D1 shape: segments on the output). */
const currentRaw = {
  version: CURRENT_KIT_VERSION,
  global: { ...global, expanded: false },
  drums,
  outputs: [{ id: 'o1', channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] }],
};
/** The same wiring as a pre-D1 (v6) file would have stored it: an intermediate data line. */
const v6Raw = {
  version: 6,
  global,
  drums,
  outputs: [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] }] }],
};

describe('assertKitVersion — the v7 floor', () => {
  it('returns a current-version kit untouched, by reference', () => {
    expect(assertKitVersion(currentRaw)).toBe(currentRaw);
  });

  it('rejects every pre-v7 version, naming the version it found', () => {
    for (const version of [1, 2, 3, 4, 5, 6]) {
      expect(() => assertKitVersion({ ...currentRaw, version })).toThrow(
        new RegExp(`unsupported kit version ${version}\\b`),
      );
    }
  });

  it('names the floor in the message so the failure is self-explaining', () => {
    expect(() => assertKitVersion({ version: 1 })).toThrow(/kit schema v7 only/);
  });

  it('passes a FUTURE version through — this build reads it as v7-shaped, never guesses', () => {
    const future = { ...currentRaw, version: CURRENT_KIT_VERSION + 1 };
    expect(assertKitVersion(future)).toBe(future);
  });

  it('passes an absent version through: kitSchema defaults it to the current version', () => {
    const noVersion = { global: { ...global, expanded: false }, drums, outputs: [] };
    expect(assertKitVersion(noVersion)).toBe(noVersion);
    expect(parseKit(noVersion).version).toBe(CURRENT_KIT_VERSION);
  });

  it('leaves a non-numeric version to the schema, which reports it with a field path', () => {
    const bad = { ...currentRaw, version: 'seven' };
    expect(assertKitVersion(bad)).toBe(bad);
    expect(() => parseKit(bad)).toThrow(/version/);
  });

  it('passes a foreign (non-object) shape through so the schema reports it', () => {
    for (const raw of [null, undefined, 42, 'kit', [1, 2]]) {
      expect(assertKitVersion(raw)).toBe(raw);
    }
  });
});

describe('parseKit — the floor fires before validation', () => {
  it('rejects a v6 file rather than splitting its data lines', () => {
    expect(() => parseKit(v6Raw)).toThrow(/unsupported kit version 6/);
  });

  it('still parses a current-version kit, dense from channel 0 (no behaviour change at v7)', () => {
    const kit = parseKit(currentRaw);
    expect(kit.version).toBe(CURRENT_KIT_VERSION);
    expect(kit.outputs[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }]);
  });

  it('reports the version before any schema error, so the cause is unambiguous', () => {
    // A v1 file that is ALSO structurally invalid (no drums) must blame the version, not the shape.
    expect(() => parseKit({ version: 1, global, drums: [] })).toThrow(/unsupported kit version 1/);
  });
});

describe('the project layer applies the same floor', () => {
  const project = (kit: unknown) => ({ name: 'p', kit, output: { rgbOrder: 'GRB' } });

  it('parseProject rejects a project carrying a pre-v7 kit', () => {
    expect(() => parseProject(project(v6Raw))).toThrow(/unsupported kit version 6/);
  });

  it('parseProjectPatch rejects one too (the device re-rig path)', () => {
    expect(() => parseProjectPatch(project(v6Raw))).toThrow(/unsupported kit version 6/);
  });

  it('a current-version project still parses, and no rgbOrder is seeded onto its outputs', () => {
    // The v<6 controller-order seed died with the ladder: an output that declares no order keeps
    // none, and the packer falls back to the controller order per pixel (unchanged downstream).
    const parsed = parseProject(project(currentRaw));
    expect(parsed.kit.version).toBe(CURRENT_KIT_VERSION);
    expect(parsed.kit.outputs[0]!.rgbOrder).toBeUndefined();
    expect(parsed.output.rgbOrder).toBe('GRB');
  });
});
