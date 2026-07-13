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

describe('patchToOutputs — D1: each web data line splits into its own core Output', () => {
  // Hoop literals are 1-based (A1): the first hoop of a drum is hoop 1. A core Output = one data
  // run; its id is the web data line's id, and its `segments` are that line's coalesced hoops.
  it('coalesces same-drum ascending-contiguous hoops within a line', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 1), h('A', 2), h('A', 3)]])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 1, hoopEnd: 3 }]);
  });

  it('splits on a drum boundary within a line', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 1), h('A', 2), h('B', 1), h('B', 2)]])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 1, hoopEnd: 2 },
      { drumId: 'B', hoopStart: 1, hoopEnd: 2 },
    ]);
  });

  it('splits on a non-contiguous (gapped) or descending hoop (never merges non-ascending)', () => {
    const routing: PatchRouting = { outputs: [output('o1', [[h('A', 1), h('A', 3), h('A', 2)]])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 1, hoopEnd: 1 },
      { drumId: 'A', hoopStart: 3, hoopEnd: 3 },
      { drumId: 'A', hoopStart: 2, hoopEnd: 2 },
    ]);
  });

  it('splits a port with multiple data lines into one core Output per line (Output = one run)', () => {
    // A#2 (end of line 0) and A#3 (start of line 1) sit on DIFFERENT lines → two core Outputs,
    // never merged into a single A1..3 run. 8-stays-8 in miniature (now 8 outputs, not 8 lines).
    const routing: PatchRouting = {
      outputs: [output('o1', [[h('A', 1), h('A', 2)], [h('A', 3), h('B', 1)]])],
    };
    const cfgs = patchToOutputs(routing);
    expect(cfgs.map((c) => c.id)).toEqual(['o1:dl0', 'o1:dl1']);
    expect(cfgs[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 1, hoopEnd: 2 }]);
    expect(cfgs[1]!.segments).toEqual([
      { drumId: 'A', hoopStart: 3, hoopEnd: 3 },
      { drumId: 'B', hoopStart: 1, hoopEnd: 1 },
    ]);
  });

  it('carries channelsPerPixel and lifts the per-line startUniverse onto the split Output', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'port-3',
          startUniverse: 10,
          channelsPerPixel: 4,
          dataLines: [dl('port-3:dl0', [h('A', 1)], 7)],
        },
      ],
    };
    const cfg = patchToOutputs(routing)[0]!;
    expect(cfg.id).toBe('port-3:dl0'); // core Output id = the data line's id
    expect(cfg.channelsPerPixel).toBe(4);
    expect(cfg.startUniverse).toBe(7); // the line's own snap wins
  });

  it('lifts the PORT startUniverse onto the first line only (migrator parity)', () => {
    // Port snapped to universe 10, two lines, neither with its own snap: line 0 inherits 10,
    // line 1 packs dense (the old walk snapped once, before line 0 — not between lines).
    const routing: PatchRouting = {
      outputs: [{ id: 'p', startUniverse: 10, channelsPerPixel: 3, dataLines: [dl('p:dl0', [h('A', 1)]), dl('p:dl1', [h('B', 1)])] }],
    };
    const cfgs = patchToOutputs(routing);
    expect(cfgs[0]!.startUniverse).toBe(10);
    expect(cfgs[1]!).not.toHaveProperty('startUniverse');
  });

  it('omits startUniverse entirely when blank (dense)', () => {
    const cfg = patchToOutputs({ outputs: [output('o1', [[h('A', 1)]])] })[0]!;
    expect(cfg).not.toHaveProperty('startUniverse');
  });

  it('preserves order across multiple outputs (ids from each line)', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [[h('A', 1)]]), output('o2', [[h('B', 1)]]), output('o3', [[h('C', 1)]])],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o1:dl0', 'o2:dl0', 'o3:dl0']);
  });

  it('skips empty data lines and outputs left with no non-empty lines', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: 'empty', channelsPerPixel: 3, dataLines: [dl('empty:dl0', [])] },
        output('o2', [[h('A', 1)]]),
        { id: 'blank', channelsPerPixel: 3, dataLines: [] },
      ],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o2:dl0']);
  });
});

describe('outputsToPatch — D1: each core Output → one web output with a single data line', () => {
  it('expands segments back to hoops on a single line, carrying startUniverse to the port', () => {
    const cfgs: OutputConfig[] = [
      { id: 'o1', startUniverse: 2, channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 3 }] },
      { id: 'o2', startUniverse: 9, channelsPerPixel: 3, segments: [{ drumId: 'B', hoopStart: 1, hoopEnd: 1 }] },
    ];
    const back = outputsToPatch(cfgs);
    expect(back.outputs).toHaveLength(2);
    expect(back.outputs[0]!.startUniverse).toBe(2);
    expect(back.outputs[0]!.dataLines).toHaveLength(1);
    expect(back.outputs[0]!.dataLines[0]!.id).toBe('o1'); // line id reused from the output id (stable round-trip)
    expect(back.outputs[0]!.dataLines[0]!.hoops).toEqual([h('A', 1), h('A', 2), h('A', 3)]);
    expect(back.outputs[1]!.startUniverse).toBe(9);
    expect(back.outputs[1]!.dataLines[0]!.hoops).toEqual([h('B', 1)]);
  });

  it('a 4×2 port/line wiring splits to 8 core Outputs and back to 8 single-line web outputs', () => {
    // 4 web outputs × 2 lines → 8 core Outputs (D1 split) → 8 single-line web outputs.
    const routing: PatchRouting = {
      outputs: Array.from({ length: 4 }, (_, o) =>
        output(String(o + 1), [[h('k', o * 2 + 1)], [h('k', o * 2 + 2)]]),
      ),
    };
    const cfgs = patchToOutputs(routing);
    expect(cfgs).toHaveLength(8); // one core Output per line
    const back = outputsToPatch(cfgs);
    expect(back.outputs).toHaveLength(8);
    expect(back.outputs.every((o) => o.dataLines.length === 1)).toBe(true);
    // ...and recompiling the round-trip is identical (order + boundaries + ids preserved).
    expect(patchToOutputs(back)).toEqual(cfgs);
  });

  const roundTrips: Record<string, PatchRouting> = {
    'contiguous coalescing': { outputs: [output('o1', [[h('A', 1), h('A', 2), h('A', 3), h('A', 4)]])] },
    'multi-line drum-boundary splits': {
      outputs: [output('o1', [[h('A', 1), h('A', 2)], [h('B', 1), h('C', 1), h('C', 2)]])],
    },
    'multi-output with startUniverse snaps': {
      outputs: [
        output('o1', [[h('A', 1), h('A', 2)]]),
        { id: 'o2', startUniverse: 5, channelsPerPixel: 4, dataLines: [dl('o2:dl0', [h('B', 1), h('B', 2)], 5)] },
      ],
    },
    'gapped + descending mix on one line': { outputs: [output('o1', [[h('A', 1), h('A', 3), h('A', 2), h('B', 1)]])] },
  };
  for (const [name, routing] of Object.entries(roundTrips)) {
    it(`stable round-trip (web→core→web→core is identical): ${name}`, () => {
      const once = patchToOutputs(routing);
      const twice = patchToOutputs(outputsToPatch(once));
      expect(twice).toEqual(once);
    });
  }
});

describe('pixelRanges', () => {
  // Hand-computed (hoops 1-based, A1): A#1 (50px) → 0..49, A#2 (50px) → 50..99, B#1 (30px) → 100..129.
  const px = (hp: HoopRef): number => (hp.drumId === 'A' ? 50 : hp.drumId === 'B' ? 30 : 0);

  it('matches the hand-computed example with one hoop per dataline', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'o1',
          channelsPerPixel: 3,
          dataLines: [dl('dlA1', [h('A', 1)]), dl('dlA2', [h('A', 2)]), dl('dlB1', [h('B', 1)])],
        },
      ],
    };
    const { byDataLine, byOutput } = pixelRanges(routing, px);
    expect(byDataLine.dlA1).toEqual({ first: 0, last: 49 });
    expect(byDataLine.dlA2).toEqual({ first: 50, last: 99 });
    expect(byDataLine.dlB1).toEqual({ first: 100, last: 129 });
    expect(byOutput.o1).toEqual({ first: 0, last: 129 });
  });

  it('aggregates multiple hoops on one dataline and across outputs', () => {
    const routing: PatchRouting = {
      outputs: [
        { id: 'o1', channelsPerPixel: 3, dataLines: [dl('dl1', [h('A', 1), h('A', 2)]), dl('dl2', [h('B', 1)])] },
        { id: 'o2', channelsPerPixel: 3, dataLines: [dl('dl3', [h('A', 3)])] },
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
        { id: 'o1', channelsPerPixel: 3, dataLines: [dl('empty', [h('Z', 1)]), dl('real', [h('A', 1)])] },
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

  it('is true when a hoop is driven by two data lines of one port (→ two split Outputs)', () => {
    // A#1 sits on BOTH lines of o1 → after the D1 split, two Outputs claim A#1 → fan-out.
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
  it('emits exactly the OutputConfig fields core consumes (segments on the output, D1)', () => {
    const cfgs: OutputConfig[] = patchToOutputs({ outputs: [output('o1', [[h('A', 1), h('A', 2)]])] });
    expect(cfgs).toEqual([
      {
        id: 'o1:dl0',
        channelsPerPixel: 3,
        segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 2 }],
      },
    ]);
  });
});
