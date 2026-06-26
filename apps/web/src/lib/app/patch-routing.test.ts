import { describe, expect, it } from 'vitest';
import type { OutputConfig } from '@ledrums/core';
import {
  DEFAULT_HOOPS_PER_DATALINE,
  outputsToPatch,
  patchToOutputs,
  pixelRanges,
  type HoopRef,
  type PatchOutput,
  type PatchRouting,
} from './patch-routing';

/** Build a single-dataline output (the common case) from a flat hoop list. */
function output(
  id: string,
  hoops: HoopRef[],
  extra: Partial<Pick<PatchOutput, 'startUniverse' | 'channelsPerPixel'>> = {},
): PatchOutput {
  return {
    id,
    startUniverse: extra.startUniverse ?? 0,
    channelsPerPixel: extra.channelsPerPixel ?? 3,
    dataLines: [{ id: `${id}:dl0`, hoops }],
  };
}

const h = (drumId: string, hoop: number): HoopRef => ({ drumId, hoop });

describe('patchToOutputs — segment coalescing', () => {
  it('coalesces same-drum ascending-contiguous hoops into one segment', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 0), h('A', 1), h('A', 2)])],
    };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 2 },
    ]);
  });

  it('splits on a drum boundary', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 0), h('A', 1), h('B', 0), h('B', 1)])],
    };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 1 },
      { drumId: 'B', hoopStart: 0, hoopEnd: 1 },
    ]);
  });

  it('splits on a non-contiguous (gapped) hoop of the same drum', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 0), h('A', 2), h('A', 3)])],
    };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 0 },
      { drumId: 'A', hoopStart: 2, hoopEnd: 3 },
    ]);
  });

  it('splits on a descending/duplicate hoop (never merges non-ascending)', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 0), h('A', 1), h('A', 0)])],
    };
    // The trailing A0 must be its own segment — core expands ascending, so merging
    // would silently reorder the transmit stream.
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 1 },
      { drumId: 'A', hoopStart: 0, hoopEnd: 0 },
    ]);
  });

  it('carries id / startUniverse / channelsPerPixel through unchanged', () => {
    const routing: PatchRouting = {
      outputs: [output('port-3', [h('A', 0)], { startUniverse: 10, channelsPerPixel: 4 })],
    };
    const cfg = patchToOutputs(routing)[0]!;
    expect(cfg.id).toBe('port-3');
    expect(cfg.startUniverse).toBe(10);
    expect(cfg.channelsPerPixel).toBe(4);
  });

  it('preserves output order across multiple outputs', () => {
    const routing: PatchRouting = {
      outputs: [
        output('o1', [h('A', 0)]),
        output('o2', [h('B', 0)]),
        output('o3', [h('C', 0)]),
      ],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('flattens multiple datalines in order before coalescing', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'o1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [
            { id: 'o1:dl0', hoops: [h('A', 0), h('A', 1)] },
            { id: 'o1:dl1', hoops: [h('A', 2), h('B', 0)] },
          ],
        },
      ],
    };
    // Dataline boundary between A1 and A2 does NOT break the run — only drum/order does.
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 0, hoopEnd: 2 },
      { drumId: 'B', hoopStart: 0, hoopEnd: 0 },
    ]);
  });

  it('skips outputs that carry no hoops', () => {
    const routing: PatchRouting = {
      outputs: [
        output('empty', []),
        output('o2', [h('A', 0)]),
        { id: 'empty2', startUniverse: 0, channelsPerPixel: 3, dataLines: [] },
      ],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o2']);
  });
});

describe('round-trip — patchToOutputs ∘ outputsToPatch ∘ patchToOutputs is stable', () => {
  const cases: Record<string, PatchRouting> = {
    'contiguous coalescing': {
      outputs: [output('o1', [h('A', 0), h('A', 1), h('A', 2), h('A', 3)])],
    },
    'drum-boundary splits': {
      outputs: [output('o1', [h('A', 0), h('A', 1), h('B', 0), h('C', 0), h('C', 1)])],
    },
    'multi-output ordering': {
      outputs: [
        output('o1', [h('A', 0), h('A', 1)], { startUniverse: 0 }),
        output('o2', [h('B', 0), h('B', 1), h('B', 2)], { startUniverse: 5, channelsPerPixel: 4 }),
      ],
    },
    'gapped + descending mix': {
      outputs: [output('o1', [h('A', 0), h('A', 2), h('A', 1), h('B', 0)])],
    },
    'empty output present': {
      outputs: [output('empty', []), output('o2', [h('A', 0), h('A', 1)])],
    },
    'long run that re-chunks across datalines': {
      // 9 hoops > DEFAULT_HOOPS_PER_DATALINE (6): forces re-chunking on the way back.
      outputs: [
        output(
          'o1',
          Array.from({ length: 9 }, (_, i) => h('A', i)),
        ),
      ],
    },
  };

  for (const [name, routing] of Object.entries(cases)) {
    it(name, () => {
      const once = patchToOutputs(routing);
      const twice = patchToOutputs(outputsToPatch(once));
      expect(twice).toEqual(once);
    });
  }

  it('default re-chunk size is honoured by outputsToPatch', () => {
    const cfgs = patchToOutputs({
      outputs: [output('o1', Array.from({ length: 13 }, (_, i) => h('A', i)))],
    });
    const back = outputsToPatch(cfgs);
    const lines = back.outputs[0]!.dataLines;
    // 13 hoops / 6 per line → 6, 6, 1
    expect(lines.map((l) => l.hoops.length)).toEqual([6, 6, 1]);
    expect(DEFAULT_HOOPS_PER_DATALINE).toBe(6);
  });

  it('respects a custom hoopsPerDataLine while preserving pixel order', () => {
    const cfgs = patchToOutputs({
      outputs: [output('o1', Array.from({ length: 5 }, (_, i) => h('A', i)))],
    });
    const back = outputsToPatch(cfgs, { hoopsPerDataLine: 2 });
    expect(back.outputs[0]!.dataLines.map((l) => l.hoops.length)).toEqual([2, 2, 1]);
    // order still round-trips through the compiler
    expect(patchToOutputs(back)).toEqual(cfgs);
  });
});

describe('pixelRanges', () => {
  // Hand-computed: A0 (50px) → 0..49, A1 (50px) → 50..99, B0 (30px) → 100..129.
  const px = (hp: HoopRef): number =>
    hp.drumId === 'A' ? 50 : hp.drumId === 'B' ? 30 : 0;

  it('matches the hand-computed example with one hoop per dataline', () => {
    const routing: PatchRouting = {
      outputs: [
        {
          id: 'o1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [
            { id: 'dlA0', hoops: [h('A', 0)] },
            { id: 'dlA1', hoops: [h('A', 1)] },
            { id: 'dlB0', hoops: [h('B', 0)] },
          ],
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
        {
          id: 'o1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [
            { id: 'dl1', hoops: [h('A', 0), h('A', 1)] }, // 0..99
            { id: 'dl2', hoops: [h('B', 0)] }, // 100..129
          ],
        },
        {
          id: 'o2',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [{ id: 'dl3', hoops: [h('A', 2)] }], // 130..179
        },
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
        {
          id: 'o1',
          startUniverse: 0,
          channelsPerPixel: 3,
          dataLines: [
            { id: 'empty', hoops: [h('Z', 0)] }, // 0px → omitted
            { id: 'real', hoops: [h('A', 0)] }, // 0..49
          ],
        },
        { id: 'blank', startUniverse: 0, channelsPerPixel: 3, dataLines: [] },
      ],
    };
    const { byDataLine, byOutput } = pixelRanges(routing, px);
    expect(byDataLine).not.toHaveProperty('empty');
    expect(byDataLine.real).toEqual({ first: 0, last: 49 });
    expect(byOutput).not.toHaveProperty('blank');
    expect(byOutput.o1).toEqual({ first: 0, last: 49 });
  });
});

describe('compiled output matches core OutputConfig shape', () => {
  it('emits exactly the OutputConfig fields core consumes', () => {
    const cfgs: OutputConfig[] = patchToOutputs({
      outputs: [output('o1', [h('A', 0), h('A', 1)])],
    });
    expect(cfgs).toEqual([
      {
        id: 'o1',
        startUniverse: 0,
        channelsPerPixel: 3,
        segments: [{ drumId: 'A', hoopStart: 0, hoopEnd: 1 }],
      },
    ]);
  });
});
