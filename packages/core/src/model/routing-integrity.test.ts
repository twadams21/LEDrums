import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { buildDmxMap } from '../geometry/dmx-map';
import {
  assertRoutingIntegrity,
  checkRoutingIntegrity,
  RoutingIntegrityError,
  validateRouting,
} from './routing-integrity';

// Hoop indices are 1-based (A1): hoop 1 is the first hoop. Fixtures below build a
// version-2 kit (already 1-based) so parseKit does not re-migrate them.

/** Build a kit with literal per-hoop counts + a topology, mirroring dmx-map.test.ts. */
function kit(
  drums: Array<{ id: string; pixelsPerHoop: number; hoopCount?: number }>,
  outputs: unknown[] = [],
) {
  return parseKit({
    version: 2,
    global: { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: drums.map((d, i) => ({
      id: d.id,
      diameterIn: 6,
      hoopSpacingMm: 50,
      hoopCount: d.hoopCount ?? 1,
      pixelsPerHoop: d.pixelsPerHoop,
      origin: { x: i * 500, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    })),
    outputs,
  });
}

const seg = (drumId: string, hoopStart = 1, hoopEnd = hoopStart) => ({ drumId, hoopStart, hoopEnd });
const dl = (id: string, segments: unknown[]) => ({ id, segments });
const out = (id: string, dataLines: unknown[]) => ({ id, channelsPerPixel: 3, dataLines });

describe('checkRoutingIntegrity', () => {
  it('passes a valid multi-drum topology (no issues)', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }, { id: 'B', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [dl('o1:dl0', [seg('A', 1, 4)]), dl('o1:dl1', [seg('B', 1, 2)])])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('an empty topology (flat-map default) is trivially valid', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }]);
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('flags a segment referencing a drum not in the kit', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [dl('o1:dl0', [seg('ghost')])])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unknown-drum');
    expect(issues[0]!.message).toMatch(/unknown drum "ghost"/);
    expect(issues[0]!.drumId).toBe('ghost');
  });

  it('flags a hoop range past the drum hoop count', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [dl('o1:dl0', [seg('A', 1, 10)])])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-out-of-range');
    expect(issues[0]!.message).toMatch(/invalid hoop range 1\.\.10 \(drum has 4 hoops\)/);
  });

  it('flags a backwards hoop range (hoopStart > hoopEnd)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [dl('o1:dl0', [seg('A', 3, 1)])])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-out-of-range');
  });

  it('flags a hoop fan-out — the same hoop driven by two data lines', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }],
      // hoop 2 of A appears on both dl0 (1..3) and dl1 (2..2) → collision.
      [out('o1', [dl('o1:dl0', [seg('A', 1, 3)]), dl('o1:dl1', [seg('A', 2, 2)])])],
    );
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-fan-out');
    expect(issues[0]!.message).toMatch(/hoop 2 of drum "A" is driven by more than one data line/);
  });

  it('does not report fan-out for adjacent, non-overlapping segments', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }],
      [out('o1', [dl('o1:dl0', [seg('A', 1, 2)]), dl('o1:dl1', [seg('A', 3, 4)])])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('collects multiple distinct issues in walk order', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [dl('o1:dl0', [seg('ghost'), seg('A', 1, 10)])])],
    );
    const codes = checkRoutingIntegrity(k).map((i) => i.code);
    expect(codes).toEqual(['unknown-drum', 'hoop-out-of-range']);
  });

  it('validates arbitrary outputs against a kit (the setKitOutputs-gate shape)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }]);
    // Kit ships no outputs; validate an INCOMING payload against its drums.
    const incoming = [out('o1', [dl('o1:dl0', [seg('A', 1, 4)])])];
    expect(checkRoutingIntegrity(k, incoming as never)).toEqual([]);
    const bad = [out('o1', [dl('o1:dl0', [seg('A', 1, 99)])])];
    expect(checkRoutingIntegrity(k, bad as never)).toHaveLength(1);
  });

  it('agrees with buildDmxMap: what it passes, buildDmxMap patches without throwing', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 12, hoopCount: 4 }, { id: 'B', pixelsPerHoop: 8, hoopCount: 2 }],
      [out('o1', [dl('o1:dl0', [seg('A', 1, 4)]), dl('o1:dl1', [seg('B', 1, 2)])])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
    expect(() => buildDmxMap(k, buildPixelModel(k))).not.toThrow();
  });

  it('agrees with buildDmxMap: what it flags (unknown drum / bad hoop), buildDmxMap throws on', () => {
    const badDrum = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [dl('o1:dl0', [seg('zzz')])])]);
    expect(checkRoutingIntegrity(badDrum)[0]!.code).toBe('unknown-drum');
    expect(() => buildDmxMap(badDrum, buildPixelModel(badDrum))).toThrow(/unknown drum/);

    const badHoop = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [dl('o1:dl0', [seg('A', 1, 10)])])]);
    expect(checkRoutingIntegrity(badHoop)[0]!.code).toBe('hoop-out-of-range');
    expect(() => buildDmxMap(badHoop, buildPixelModel(badHoop))).toThrow(/invalid hoop range/);
  });
});

describe('validateRouting (schema + integrity over raw input)', () => {
  const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }]);

  it('passes a well-formed, resolvable topology', () => {
    expect(validateRouting(k, [out('o1', [dl('o1:dl0', [seg('A', 1, 4)])])])).toEqual([]);
  });

  it('reports malformed shape as a distinct schema issue (channelsPerPixel 0)', () => {
    const bad = [{ id: 'o1', channelsPerPixel: 0, dataLines: [{ id: 'd', segments: [seg('A')] }] }];
    const issues = validateRouting(k, bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('schema');
    expect(issues[0]!.path).toMatch(/channelsPerPixel/);
  });

  it('reports empty dataLines as a schema issue', () => {
    const issues = validateRouting(k, [{ id: 'o1', channelsPerPixel: 3, dataLines: [] }]);
    expect(issues[0]!.code).toBe('schema');
  });

  it('reports a zero/negative hoop range as a schema issue (positive-int shape, 1-based A1)', () => {
    const bad = [{ id: 'o1', channelsPerPixel: 3, dataLines: [{ id: 'd', segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 2 }] }] }];
    expect(validateRouting(k, bad)[0]!.code).toBe('schema');
  });

  it('falls through to integrity once the shape is valid (dangling ref, out-of-range hoop, fan-out)', () => {
    expect(validateRouting(k, [out('o1', [dl('d', [seg('ghost')])])])[0]!.code).toBe('unknown-drum');
    expect(validateRouting(k, [out('o1', [dl('d', [seg('A', 1, 10)])])])[0]!.code).toBe('hoop-out-of-range');
    expect(
      validateRouting(k, [out('o1', [dl('d0', [seg('A', 1, 1)]), dl('d1', [seg('A', 1, 1)])])])[0]!.code,
    ).toBe('hoop-fan-out');
  });

  it('all four corruption classes carry a distinct code', () => {
    const codes = new Set([
      validateRouting(k, [{ id: 'o1', channelsPerPixel: 0, dataLines: [{ id: 'd', segments: [seg('A')] }] }])[0]!.code,
      validateRouting(k, [out('o1', [dl('d', [seg('ghost')])])])[0]!.code,
      validateRouting(k, [out('o1', [dl('d', [seg('A', 1, 10)])])])[0]!.code,
      validateRouting(k, [out('o1', [dl('d0', [seg('A', 1, 1)]), dl('d1', [seg('A', 1, 1)])])])[0]!.code,
    ]);
    expect(codes).toEqual(new Set(['schema', 'unknown-drum', 'hoop-out-of-range', 'hoop-fan-out']));
  });
});

describe('assertRoutingIntegrity', () => {
  it('does not throw for a valid topology', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [dl('o1:dl0', [seg('A', 1, 4)])])]);
    expect(() => assertRoutingIntegrity(k)).not.toThrow();
  });

  it('throws a named error carrying every issue', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }], [out('o1', [dl('o1:dl0', [seg('ghost')])])]);
    expect(() => assertRoutingIntegrity(k)).toThrow(RoutingIntegrityError);
    try {
      assertRoutingIntegrity(k);
    } catch (err) {
      expect(err).toBeInstanceOf(RoutingIntegrityError);
      expect((err as RoutingIntegrityError).issues).toHaveLength(1);
      expect((err as RoutingIntegrityError).issues[0]!.code).toBe('unknown-drum');
    }
  });
});
