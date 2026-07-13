import { describe, expect, it } from 'vitest';
import { parseKit, type OutputConfig } from '@ledrums/core';
import {
  hasHoopFanOut,
  outputsToPatch,
  patchToOutputs,
  pixelRanges,
  type DataLine,
  type HoopRef,
  type PatchOutput,
  type PatchRouting,
} from './patch-routing';

const h = (drumId: string, hoop: number): HoopRef => ({ drumId, hoop });

/** A data line of hoops, with an optional startUniverse snap. */
const dl = (id: string, hoops: HoopRef[], startUniverse?: number): DataLine =>
  startUniverse === undefined ? { id, hoops } : { id, startUniverse, hoops };

/** An output from a list of data lines (ids `${id}:dl<n>`), optional transport extras. */
function output(
  id: string,
  lines: HoopRef[][],
  extra: Partial<Pick<PatchOutput, 'startUniverse' | 'channelsPerPixel'>> = {},
): PatchOutput {
  return {
    id,
    channelsPerPixel: extra.channelsPerPixel ?? 3,
    ...(extra.startUniverse !== undefined ? { startUniverse: extra.startUniverse } : {}),
    dataLines: lines.map((hoops, i) => dl(`${id}:dl${i}`, hoops)),
  };
}

describe('patchToOutputs — per-line coalescing, data lines 1:1', () => {
  it('coalesces same-drum ascending-contiguous hoops within a line', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 0), h('A', 1), h('A', 2)]])] };
    expect(patchToOutputs(routing)[0]!.dataLines[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 2 },
    ]);
  });

  it('splits on a drum boundary within a line', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 0), h('A', 1), h('B', 0), h('B', 1)]])] };
    expect(patchToOutputs(routing)[0]!.dataLines[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 1 },
      { drumId: 'B', hoopStart: 0, hoopEnd: 1 },
    ]);
  });

  it('splits on a non-contiguous (gapped) or descending hoop (never merges non-ascending)', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 0), h('A', 2), h('A', 1)]])] };
    expect(patchToOutputs(routing)[0]!.dataLines[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 0 },
      { drumId: 'A', hoopStart: 2, hoopEnd: 2 },
      { drumId: 'A', hoopStart: 1, hoopEnd: 1 },
    ]);
  });

  it('maps multiple data lines 1:1 — a line boundary is NOT flattened away', () => {
    // A1 and A2 sit on DIFFERENT lines: they must stay two segments on two lines, never
    // merged into a single A0..2 run (the old flatten behaviour). 8-stays-8 in miniature.
    const routing: PatchRouting = {
      outputs: [output('o1', [[h('A', 0), h('A', 1)], [h('A', 2), h('B', 0)]])],
    };
    const cfg = patchToOutputs(routing)[0]!;
    expect(cfg.dataLines).toHaveLength(2);
    expect(cfg.dataLines[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 0, hoopEnd: 1 }]);
    expect(cfg.dataLines[1]!.segments).toEqual([
      { drumId: 'A', hoopStart: 2, hoopEnd: 2 },
      { drumId: 'B', hoopStart: 0, hoopEnd: 0 },
    ]);
  });

  it('carries output id / startUniverse / channelsPerPixel and per-line startUniverse through', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'port-3',
          startUniverse: 10,
          channelsPerPixel: 4,
          dataLines: [dl('port-3:dl0', [h('A', 0)], 7)],
        },
      ],
    };
    const cfg = patchToOutputs(routing)[0]!;
    expect(cfg.id).toBe('port-3');
    expect(cfg.startUniverse).toBe(10);
    expect(cfg.channelsPerPixel).toBe(4);
    expect(cfg.dataLines[0]!.startUniverse).toBe(7);
  });

  it('omits startUniverse entirely when blank (dense)', () => {
    const cfg = patchToOutputs({ outputs: [output('o1', [[h('A', 0)]])] })[0]!;
    expect(cfg).not.toHaveProperty('startUniverse');
    expect(cfg.dataLines[0]!).not.toHaveProperty('startUniverse');
  });

  it('preserves output order across multiple outputs', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [[h('A', 0)]]), output('o2', [[h('B', 0)]]), output('o3', [[h('C', 0)]])],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('skips empty data lines and outputs left with no non-empty lines', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: 'empty', channelsPerPixel: 3, dataLines: [dl('empty:dl0', [])] },
        output('o2', [[h('A', 0)]]),
        { id: 'blank', channelsPerPixel: 3, dataLines: [] },
      ],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o2']);
  });
});

describe('outputsToPatch — 1:1 inverse (no re-chunk)', () => {
  it('expands each line back to hoops, preserving line count / ids / startUniverse', () => {
    const cfgs: OutputConfig[] = [
      {
        id: 'o1',
        startUniverse: 2,
        channelsPerPixel: 3,
        dataLines: [
          { id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 2 }] },
          { id: 'o1:dl1', startUniverse: 9, segments: [{ drumId: 'B', hoopStart: 0, hoopEnd: 0 }] },
        ],
      },
    ];
    const back = outputsToPatch(cfgs);
    expect(back.outputs[0]!.startUniverse).toBe(2);
    expect(back.outputs[0]!.dataLines).toHaveLength(2);
    expect(back.outputs[0]!.dataLines[0]!.hoops).toEqual([h('A', 0), h('A', 1), h('A', 2)]);
    expect(back.outputs[0]!.dataLines[1]!.startUniverse).toBe(9);
    expect(back.outputs[0]!.dataLines[1]!.hoops).toEqual([h('B', 0)]);
  });

  it('wiring 8 data lines round-trips as 8 (no collapse, no re-chunk)', () => {
    // 4 outputs × 2 lines, each line a distinct hoop run.
    const routing: PatchRouting = {
      outputs: Array.from({ length: 4 }, (_, o) =>
        output(String(o + 1), [[h('k', o * 2)], [h('k', o * 2 + 1)]]),
      ),
    };
    const cfgs = patchToOutputs(routing);
    const lineCount = cfgs.reduce((n, c) => n + c.dataLines.length, 0);
    expect(lineCount).toBe(8);
    const back = outputsToPatch(cfgs);
    expect(back.outputs.reduce((n, o) => n + o.dataLines.length, 0)).toBe(8);
    // ...and recompiling the round-trip is identical (order + boundaries preserved).
    expect(patchToOutputs(back)).toEqual(cfgs);
  });

  const roundTrips: Record<string, PatchRouting> = {
    'contiguous coalescing': { outputs: [output('o1', [[h('A', 0), h('A', 1), h('A', 2), h('A', 3)]])] },
    'multi-line drum-boundary splits': {
      outputs: [output('o1', [[h('A', 0), h('A', 1)], [h('B', 0), h('C', 0), h('C', 1)]])],
    },
    'multi-output with startUniverse snaps': {
      outputs: [
        output('o1', [[h('A', 0), h('A', 1)]]),
        { id: 'o2', startUniverse: 5, channelsPerPixel: 4, dataLines: [dl('o2:dl0', [h('B', 0), h('B', 1)], 5)] },
      ],
    },
    'gapped + descending mix on one line': { outputs: [output('o1', [[h('A', 0), h('A', 2), h('A', 1), h('B', 0)]])] },
  };
  for (const [name, routing] of Object.entries(roundTrips)) {
    it(`stable round-trip: ${name}`, () => {
      const once = patchToOutputs(routing);
      const twice = patchToOutputs(outputsToPatch(once));
      expect(twice).toEqual(once);
    });
  }
});

describe('pixelRanges', () => {
  // Hand-computed: A0 (50px) → 0..49, A1 (50px) → 50..99, B0 (30px) → 100..129.
  const px = (hp: HoopRef): number => (hp.drumId === 'A' ? 50 : hp.drumId === 'B' ? 30 : 0);

  it('matches the hand-computed example with one hoop per dataline', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'o1',
          channelsPerPixel: 3,
          dataLines: [dl('dlA0', [h('A', 0)]), dl('dlA1', [h('A', 1)]), dl('dlB0', [h('B', 0)])],
        },
      ],
    };
    const { byDataLine, byOutput } = pixelRanges(routing, px);
    expect(byDataLine.dlA0).toEqual({ first: 0, last: 49 });
    expect(byDataLine.dlA1).toEqual({ first: 50, last: 99 });
    expect(byDataLine.dlB0).toEqual({ first: 100, last: 129 });
    expect(byOutput.o1).toEqual({ first: 0, last: 129 });
  });

  it('aggregates multiple hoops on one dataline and across outputs', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: 'o1', channelsPerPixel: 3, dataLines: [dl('dl1', [h('A', 0), h('A', 1)]), dl('dl2', [h('B', 0)])] },
        { id: 'o2', channelsPerPixel: 3, dataLines: [dl('dl3', [h('A', 2)])] },
      ],
    };
    const { byDataLine, byOutput } = pixelRanges(routing, px);
    expect(byDataLine.dl1).toEqual({ first: 0, last: 99 });
    expect(byDataLine.dl2).toEqual({ first: 100, last: 129 });
    expect(byDataLine.dl3).toEqual({ first: 130, last: 179 });
    expect(byOutput.o1).toEqual({ first: 0, last: 129 });
    expect(byOutput.o2).toEqual({ first: 130, last: 179 });
  });

  it('omits zero-pixel datalines and outputs', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: 'o1', channelsPerPixel: 3, dataLines: [dl('empty', [h('Z', 0)]), dl('real', [h('A', 0)])] },
        { id: 'blank', channelsPerPixel: 3, dataLines: [] },
      ],
    };
    const { byDataLine, byOutput } = pixelRanges(routing, px);
    expect(byDataLine).not.toHaveProperty('empty');
    expect(byDataLine.real).toEqual({ first: 0, last: 49 });
    expect(byOutput).not.toHaveProperty('blank');
    expect(byOutput.o1).toEqual({ first: 0, last: 49 });
  });
});

describe('hasHoopFanOut — S07 fan-out rule, editor-side (S11)', () => {
  // A kit with two drums, enough hoops to fan out; mirrors routing-integrity.test.ts's builder.
  const kit = parseKit({
    global: { ledDensityPxPerM: 100, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 10, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'B', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 2, pixelsPerHoop: 10, origin: { x: 500, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
    outputs: [],
  });

  it('is false for a clean routing — every hoop on exactly one line', () => {
    // Hoops are 1-based (A1): A hoops 1..2, B hoop 1.
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 1), h('A', 2)], [h('B', 1)]])] };
    expect(hasHoopFanOut(kit, routing)).toBe(false);
  });

  it('is true when a hoop is driven by two data lines (same output)', () => {
    // A#1 sits on BOTH lines of o1 → the fan-out S07 flags.
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 1), h('A', 2)], [h('A', 1)]])] };
    expect(hasHoopFanOut(kit, routing)).toBe(true);
  });

  it('is true when a hoop is driven across two outputs', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [[h('A', 1)]]), output('o2', [[h('A', 1)]])],
    };
    expect(hasHoopFanOut(kit, routing)).toBe(true);
  });

  it('a re-home (hoop MOVED to another line) stays clean — reconnect is not a fan-out', () => {
    // Before: A#1 on line 0. After the move: A#1 on line 1 only. One line throughout → no fan-out.
    const before: PatchRouting = { outputs: [output('o1', [[h('A', 1)], [h('B', 1)]])] };
    const afterMove: PatchRouting = { outputs: [output('o1', [[], [h('B', 1), h('A', 1)]])] };
    expect(hasHoopFanOut(kit, before)).toBe(false);
    expect(hasHoopFanOut(kit, afterMove)).toBe(false);
  });
});

describe('compiled output matches core OutputConfig shape', () => {
  it('emits exactly the OutputConfig fields core consumes (dataLines + segments)', () => {
    const cfgs: OutputConfig[] = patchToOutputs({ outputs: [output('o1', [[h('A', 0), h('A', 1)]])] });
    expect(cfgs).toEqual([
      {
        id: 'o1',
        channelsPerPixel: 3,
        dataLines: [{ id: 'o1:dl0', segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 1 }] }],
      },
    ]);
  });
});
