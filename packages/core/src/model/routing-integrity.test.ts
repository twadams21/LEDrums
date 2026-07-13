import { describe, expect, it } from 'vitest';
import { parseKit, drumHoopCount, type OutputConfig } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { buildDmxMap } from '../geometry/dmx-map';
import {
  assertRoutingIntegrity,
  blockingRoutingIssues,
  checkRoutingIntegrity,
  RoutingIntegrityError,
  validateRouting,
} from './routing-integrity';
import { DEFAULT_KIT } from './defaults';

// Hoop indices are 1-based (A1): hoop 1 is the first hoop. Fixtures below build a
// version-2 kit (already 1-based) so parseKit does not re-shift their hoop ranges. (Parse
// still runs the B2 expanded default-ON step, which is irrelevant to routing integrity.)
// D1: an output carries its `segments` chain directly — the intermediate data line is gone,
// so a hoop driven by two runs is now a collision across two OUTPUTS (not two data lines).

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
// D1: an output = one data run carrying its `segments` chain directly.
const out = (id: string, segments: unknown[]) => ({ id, channelsPerPixel: 3, segments });

describe('checkRoutingIntegrity', () => {
  it('passes a valid multi-drum topology (no issues)', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }, { id: 'B', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [seg('A', 1, 4)]), out('o2', [seg('B', 1, 2)])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('an empty topology (flat-map default) is trivially valid', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }]);
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('flags a segment referencing a drum not in the kit', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [seg('ghost')])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('unknown-drum');
    expect(issues[0]!.message).toMatch(/unknown drum "ghost"/);
    expect(issues[0]!.drumId).toBe('ghost');
  });

  it('flags a hoop range past the drum hoop count', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [seg('A', 1, 10)])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-out-of-range');
    expect(issues[0]!.message).toMatch(/invalid hoop range 1\.\.10 \(drum has 4 hoops\)/);
  });

  it('flags a backwards hoop range (hoopStart > hoopEnd)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [seg('A', 3, 1)])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-out-of-range');
  });

  it('flags a hoop fan-out — the same hoop driven by two outputs', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }],
      // hoop 2 of A appears on both o1 (1..3) and o2 (2..2) → collision.
      [out('o1', [seg('A', 1, 3)]), out('o2', [seg('A', 2, 2)])],
    );
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('hoop-fan-out');
    expect(issues[0]!.message).toMatch(/hoop 2 of drum "A" is driven by more than one output/);
  });

  it('does not report fan-out for adjacent, non-overlapping segments on one output', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }],
      [out('o1', [seg('A', 1, 2), seg('A', 3, 4)])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('collects multiple distinct issues in walk order', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [seg('ghost'), seg('A', 1, 10)])],
    );
    const codes = checkRoutingIntegrity(k).map((i) => i.code);
    expect(codes).toEqual(['unknown-drum', 'hoop-out-of-range']);
  });

  it('validates arbitrary outputs against a kit (the setKitOutputs-gate shape)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }]);
    // Kit ships no outputs; validate an INCOMING payload against its drums.
    const incoming = [out('o1', [seg('A', 1, 4)])];
    expect(checkRoutingIntegrity(k, incoming as never)).toEqual([]);
    const bad = [out('o1', [seg('A', 1, 99)])];
    expect(checkRoutingIntegrity(k, bad as never)).toHaveLength(1);
  });

  it('agrees with buildDmxMap: what it passes, buildDmxMap patches without throwing', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 12, hoopCount: 4 }, { id: 'B', pixelsPerHoop: 8, hoopCount: 2 }],
      [out('o1', [seg('A', 1, 4)]), out('o2', [seg('B', 1, 2)])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
    expect(() => buildDmxMap(k, buildPixelModel(k))).not.toThrow();
  });

  it('agrees with buildDmxMap: what it flags (unknown drum / bad hoop), buildDmxMap throws on', () => {
    const badDrum = kit([{ id: 'A', pixelsPerHoop: 10 }], [out('o1', [seg('zzz')])]);
    expect(checkRoutingIntegrity(badDrum)[0]!.code).toBe('unknown-drum');
    expect(() => buildDmxMap(badDrum, buildPixelModel(badDrum))).toThrow(/unknown drum/);

    const badHoop = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [seg('A', 1, 10)])]);
    expect(checkRoutingIntegrity(badHoop)[0]!.code).toBe('hoop-out-of-range');
    expect(() => buildDmxMap(badHoop, buildPixelModel(badHoop))).toThrow(/invalid hoop range/);
  });
});

describe('validateRouting (schema + integrity over raw input)', () => {
  const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }]);

  it('passes a well-formed, resolvable topology', () => {
    expect(validateRouting(k, [out('o1', [seg('A', 1, 4)])])).toEqual([]);
  });

  it('reports malformed shape as a distinct schema issue (channelsPerPixel 0)', () => {
    const bad = [{ id: 'o1', channelsPerPixel: 0, segments: [seg('A')] }];
    const issues = validateRouting(k, bad);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('schema');
    expect(issues[0]!.path).toMatch(/channelsPerPixel/);
  });

  it('reports empty segments as a schema issue', () => {
    const issues = validateRouting(k, [{ id: 'o1', channelsPerPixel: 3, segments: [] }]);
    expect(issues[0]!.code).toBe('schema');
  });

  it('reports a zero/negative hoop range as a schema issue (positive-int shape, 1-based A1)', () => {
    const bad = [{ id: 'o1', channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 2 }] }];
    expect(validateRouting(k, bad)[0]!.code).toBe('schema');
  });

  it('falls through to integrity once the shape is valid (dangling ref, out-of-range hoop, fan-out)', () => {
    expect(validateRouting(k, [out('o1', [seg('ghost')])])[0]!.code).toBe('unknown-drum');
    expect(validateRouting(k, [out('o1', [seg('A', 1, 10)])])[0]!.code).toBe('hoop-out-of-range');
    expect(
      validateRouting(k, [out('o1', [seg('A', 1, 1)]), out('o2', [seg('A', 1, 1)])])[0]!.code,
    ).toBe('hoop-fan-out');
  });

  it('all four corruption classes carry a distinct code', () => {
    const codes = new Set([
      validateRouting(k, [{ id: 'o1', channelsPerPixel: 0, segments: [seg('A')] }])[0]!.code,
      validateRouting(k, [out('o1', [seg('ghost')])])[0]!.code,
      validateRouting(k, [out('o1', [seg('A', 1, 10)])])[0]!.code,
      validateRouting(k, [out('o1', [seg('A', 1, 1)]), out('o2', [seg('A', 1, 1)])])[0]!.code,
    ]);
    expect(codes).toEqual(new Set(['schema', 'unknown-drum', 'hoop-out-of-range', 'hoop-fan-out']));
  });
});

describe('assertRoutingIntegrity', () => {
  it('does not throw for a valid topology', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }], [out('o1', [seg('A', 1, 4)])]);
    expect(() => assertRoutingIntegrity(k)).not.toThrow();
  });

  it('throws a named error carrying every issue', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }], [out('o1', [seg('ghost')])]);
    expect(() => assertRoutingIntegrity(k)).toThrow(RoutingIntegrityError);
    try {
      assertRoutingIntegrity(k);
    } catch (err) {
      expect(err).toBeInstanceOf(RoutingIntegrityError);
      expect((err as RoutingIntegrityError).issues).toHaveLength(1);
      expect((err as RoutingIntegrityError).issues[0]!.code).toBe('unknown-drum');
    }
  });

  it('does NOT throw for an incomplete-but-valid topology (warnings only, B1)', () => {
    // A#2/A#3 unrouted → hoop-uncovered warnings, but no error → assert stays silent (accept-on-warning).
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }], [out('o1', [seg('A', 1, 1)])]);
    expect(checkRoutingIntegrity(k).every((i) => i.severity === 'warning')).toBe(true);
    expect(() => assertRoutingIntegrity(k)).not.toThrow();
  });
});

describe('hoop-uncovered completeness (WARNING, B1)', () => {
  it('a NON-EMPTY topology covering every kit hoop has no issue', () => {
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }, { id: 'B', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [seg('A', 1, 3)]), out('o2', [seg('B', 1, 2)])],
    );
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('flags a kit hoop carried on no output chain, as a warning (not an error)', () => {
    // B has 2 hoops but only B#1 is routed → B#2 is unrouted.
    const k = kit(
      [{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }, { id: 'B', pixelsPerHoop: 10, hoopCount: 2 }],
      [out('o1', [seg('A', 1, 2)]), out('o2', [seg('B', 1, 1)])],
    );
    const issues = checkRoutingIntegrity(k);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'hoop-uncovered', severity: 'warning', drumId: 'B' });
    expect(issues[0]!.message).toMatch(/hoop 2 of drum "B" is not carried on any output chain/);
  });

  it('reports every uncovered hoop, in drum → hoop walk order', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }], [out('o1', [seg('A', 1, 1)])]);
    const issues = checkRoutingIntegrity(k);
    expect(issues.map((i) => ({ code: i.code, severity: i.severity, drumId: i.drumId }))).toEqual([
      { code: 'hoop-uncovered', severity: 'warning', drumId: 'A' },
      { code: 'hoop-uncovered', severity: 'warning', drumId: 'A' },
    ]);
    expect(issues[0]!.message).toMatch(/hoop 2 of drum "A"/);
    expect(issues[1]!.message).toMatch(/hoop 3 of drum "A"/);
  });

  it('does NOT flag an empty topology — the flat-map default covers every pixel', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }]); // outputs: []
    expect(checkRoutingIntegrity(k)).toEqual([]);
  });

  it('is suppressed when an ERROR is present — a broken routing is not also nagged about coverage', () => {
    // A#1/A#2 uncovered AND a dangling drum ref → only the error surfaces, no coverage warnings.
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }], [out('o1', [seg('ghost')])]);
    expect(checkRoutingIntegrity(k).map((i) => i.code)).toEqual(['unknown-drum']);
  });

  it('an uncovered hoop is NOT a corruption — buildDmxMap patches it without throwing', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }], [out('o1', [seg('A', 1, 1)])]);
    expect(checkRoutingIntegrity(k).every((i) => i.code === 'hoop-uncovered')).toBe(true);
    expect(() => buildDmxMap(k, buildPixelModel(k))).not.toThrow();
  });

  it('validateRouting surfaces the warning but it is NOT blocking (server accepts)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }]);
    const incomplete = [out('o1', [seg('A', 1, 1)])]; // A#2 unrouted
    const issues = validateRouting(k, incomplete as never);
    expect(issues.map((i) => i.code)).toEqual(['hoop-uncovered']);
    expect(blockingRoutingIssues(issues)).toEqual([]); // ← the server would apply this routing
  });
});

describe('blockingRoutingIssues — the ONE accept/reject split (parity across both write-gates)', () => {
  it('drops warnings (incomplete coverage is accepted)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 3 }], [out('o1', [seg('A', 1, 1)])]);
    const all = checkRoutingIntegrity(k);
    expect(all).toHaveLength(2); // two uncovered warnings
    expect(blockingRoutingIssues(all)).toEqual([]);
  });

  it('keeps error-severity issues (real corruption still rejects)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 2 }], [out('o1', [seg('ghost')])]);
    expect(blockingRoutingIssues(checkRoutingIntegrity(k)).map((i) => i.code)).toEqual(['unknown-drum']);
  });

  it('every referential/structural/schema class is error-severity (only hoop-uncovered is a warning)', () => {
    const k = kit([{ id: 'A', pixelsPerHoop: 10, hoopCount: 4 }]);
    const errorCodes = [
      validateRouting(k, [{ id: 'o1', channelsPerPixel: 0, segments: [seg('A')] }]),
      validateRouting(k, [out('o1', [seg('ghost')])]),
      validateRouting(k, [out('o1', [seg('A', 1, 10)])]),
      validateRouting(k, [out('o1', [seg('A', 1, 1)]), out('o2', [seg('A', 1, 1)])]),
    ];
    for (const issues of errorCodes) expect(issues[0]!.severity).toBe('error');
  });
});

describe('DMX parity (guards A1 + B1): the default kit compiles to an identical DMX map', () => {
  it('a full-coverage authored topology == the no-outputs flat-map default, byte-for-byte', () => {
    // outputs: [] → buildDmxMap derives the flat single-output map over every pixel, in kit order.
    const flat = buildDmxMap(DEFAULT_KIT, buildPixelModel(DEFAULT_KIT));

    // The SAME order made explicit: one dense output carrying every drum's hoops 1..N in kit order.
    const authored: OutputConfig[] = [
      {
        id: 'full',
        channelsPerPixel: 3,
        segments: DEFAULT_KIT.drums.map((d) => ({ drumId: d.id, hoopStart: 1, hoopEnd: drumHoopCount(DEFAULT_KIT, d) })),
      },
    ];
    const withOutputs = { ...DEFAULT_KIT, outputs: authored };

    // Complete + valid → no issues at all (also a completeness accept-case on the real kit).
    expect(checkRoutingIntegrity(withOutputs)).toEqual([]);

    const explicit = buildDmxMap(withOutputs, buildPixelModel(withOutputs));
    expect(explicit.perPixel).toEqual(flat.perPixel);
    expect(explicit.universes).toEqual(flat.universes);
  });
});
