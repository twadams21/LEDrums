import { describe, expect, it } from 'vitest';
import { parseKit, type OutputConfig } from '@ledrums/core';
import {
  hasHoopFanOut,
  outputsToPatch,
  patchToOutputs,
  pixelRanges,
  type HoopRef,
  type PatchOutput,
  type PatchRouting,
} from './patch-routing';

const h = (drumId: string, hoop: number): HoopRef => ({ drumId, hoop });

/** An output = one flat hoop chain (D1: Output = exactly one data run), optional transport. */
function output(
  id: string,
  hoops: HoopRef[],
  extra: Partial<Pick<PatchOutput, 'startUniverse' | 'channelsPerPixel' | 'rgbOrder'>> = {},
): PatchOutput {
  return {
    id,
    channelsPerPixel: extra.channelsPerPixel ?? 3,
    ...(extra.startUniverse !== undefined ? { startUniverse: extra.startUniverse } : {}),
    ...(extra.rgbOrder !== undefined ? { rgbOrder: extra.rgbOrder } : {}),
    hoops,
  };
}

describe('patchToOutputs — D1: each web output → one core Output (Output = one data run)', () => {
  // Hoop literals are 1-based (A1): the first hoop of a drum is hoop 1. A core Output = one data
  // run; its id is the web output's id, and its `segments` are the output's coalesced hoops.
  it('coalesces same-drum ascending-contiguous hoops into one segment', () => {
    const routing: PatchRouting = { outputs: [output('o1', [h('A', 1), h('A', 2), h('A', 3)])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 1, hoopEnd: 3 }]);
  });

  it('splits on a drum boundary within the chain', () => {
    const routing: PatchRouting = { outputs: [output('o1', [h('A', 1), h('A', 2), h('B', 1), h('B', 2)])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 1, hoopEnd: 2 },
      { drumId: 'B', hoopStart: 1, hoopEnd: 2 },
    ]);
  });

  it('splits on a non-contiguous (gapped) or descending hoop (never merges non-ascending)', () => {
    const routing: PatchRouting = { outputs: [output('o1', [h('A', 1), h('A', 3), h('A', 2)])] };
    expect(patchToOutputs(routing)[0]!.segments).toEqual([
      { drumId: 'A', hoopStart: 1, hoopEnd: 1 },
      { drumId: 'A', hoopStart: 3, hoopEnd: 3 },
      { drumId: 'A', hoopStart: 2, hoopEnd: 2 },
    ]);
  });

  it('carries channelsPerPixel, startUniverse and rgbOrder straight onto the core Output', () => {
    const routing: PatchRouting = {
      outputs: [output('port-3', [h('A', 1)], { startUniverse: 7, channelsPerPixel: 4, rgbOrder: 'GRB' })],
    };
    const cfg = patchToOutputs(routing)[0]!;
    expect(cfg.id).toBe('port-3'); // core Output id = the web output's id (1:1)
    expect(cfg.channelsPerPixel).toBe(4);
    expect(cfg.startUniverse).toBe(7);
    expect(cfg.rgbOrder).toBe('GRB');
  });

  it('omits startUniverse / rgbOrder entirely when blank (dense / default order)', () => {
    const cfg = patchToOutputs({ outputs: [output('o1', [h('A', 1)])] })[0]!;
    expect(cfg).not.toHaveProperty('startUniverse');
    expect(cfg).not.toHaveProperty('rgbOrder');
  });

  it('preserves output order and ids', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 1)]), output('o2', [h('B', 1)]), output('o3', [h('C', 1)])],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('skips inert outputs left with no hoops (core requires segments.min(1))', () => {
    const routing: PatchRouting = {
      outputs: [output('empty', []), output('o2', [h('A', 1)]), output('blank', [])],
    };
    expect(patchToOutputs(routing).map((o) => o.id)).toEqual(['o2']);
  });
});

describe('outputsToPatch — D1: each core Output → one web output (1:1)', () => {
  it('expands segments back to hoops, carrying transport across', () => {
    const cfgs: OutputConfig[] = [
      { id: 'o1', startUniverse: 2, channelsPerPixel: 3, rgbOrder: 'GRB', segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 3 }] },
      { id: 'o2', startUniverse: 9, channelsPerPixel: 3, segments: [{ drumId: 'B', hoopStart: 1, hoopEnd: 1 }] },
    ];
    const back = outputsToPatch(cfgs);
    expect(back.outputs).toHaveLength(2);
    expect(back.outputs[0]!.id).toBe('o1');
    expect(back.outputs[0]!.startUniverse).toBe(2);
    expect(back.outputs[0]!.rgbOrder).toBe('GRB');
    expect(back.outputs[0]!.hoops).toEqual([h('A', 1), h('A', 2), h('A', 3)]);
    expect(back.outputs[1]!.startUniverse).toBe(9);
    expect(back.outputs[1]!.hoops).toEqual([h('B', 1)]);
  });

  it('an 8-output wiring round-trips identically (order + boundaries + ids preserved)', () => {
    const routing: PatchRouting = {
      outputs: Array.from({ length: 8 }, (_, o) => output(String(o + 1), [h('k', o + 1)])),
    };
    const cfgs = patchToOutputs(routing);
    expect(cfgs).toHaveLength(8);
    const back = outputsToPatch(cfgs);
    expect(back.outputs).toHaveLength(8);
    expect(patchToOutputs(back)).toEqual(cfgs);
  });

  const roundTrips: Record<string, PatchRouting> = {
    'contiguous coalescing': { outputs: [output('o1', [h('A', 1), h('A', 2), h('A', 3), h('A', 4)])] },
    'multi-segment drum-boundary splits': {
      outputs: [output('o1', [h('A', 1), h('A', 2), h('B', 1), h('C', 1), h('C', 2)])],
    },
    'multi-output with startUniverse + rgbOrder snaps': {
      outputs: [
        output('o1', [h('A', 1), h('A', 2)]),
        output('o2', [h('B', 1), h('B', 2)], { startUniverse: 5, channelsPerPixel: 4, rgbOrder: 'BGR' }),
      ],
    },
    'gapped + descending mix on one chain': { outputs: [output('o1', [h('A', 1), h('A', 3), h('A', 2), h('B', 1)])] },
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

  it('matches the hand-computed example, keyed by output', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 1)]), output('o2', [h('A', 2)]), output('o3', [h('B', 1)])],
    };
    const { byOutput } = pixelRanges(routing, px);
    expect(byOutput.o1).toEqual({ first: 0, last: 49 });
    expect(byOutput.o2).toEqual({ first: 50, last: 99 });
    expect(byOutput.o3).toEqual({ first: 100, last: 129 });
  });

  it('aggregates multiple hoops within an output and across outputs', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('A', 1), h('A', 2), h('B', 1)]), output('o2', [h('A', 3)])],
    };
    const { byOutput } = pixelRanges(routing, px);
    expect(byOutput.o1).toEqual({ first: 0, last: 129 });
    expect(byOutput.o2).toEqual({ first: 130, last: 179 });
  });

  it('omits zero-pixel outputs', () => {
    const routing: PatchRouting = {
      outputs: [output('o1', [h('Z', 1), h('A', 1)]), output('blank', [h('Z', 2)])],
    };
    const { byOutput } = pixelRanges(routing, px);
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

  it('is false for a clean routing — every hoop on exactly one output', () => {
    // Hoops are 1-based (A1): A hoops 1..2 on o1, B hoop 1 on o2.
    const routing: PatchRouting = { outputs: [output('o1', [h('A', 1), h('A', 2)]), output('o2', [h('B', 1)])] };
    expect(hasHoopFanOut(kit, routing)).toBe(false);
  });

  it('is true when a hoop is driven across two outputs', () => {
    const routing: PatchRouting = { outputs: [output('o1', [h('A', 1)]), output('o2', [h('A', 1)])] };
    expect(hasHoopFanOut(kit, routing)).toBe(true);
  });

  it('a re-home (hoop MOVED to another output) stays clean — reconnect is not a fan-out', () => {
    // Before: A#1 on o1. After the move: A#1 on o2 only. One output throughout → no fan-out.
    const before: PatchRouting = { outputs: [output('o1', [h('A', 1)]), output('o2', [h('B', 1)])] };
    const afterMove: PatchRouting = { outputs: [output('o1', []), output('o2', [h('B', 1), h('A', 1)])] };
    expect(hasHoopFanOut(kit, before)).toBe(false);
    expect(hasHoopFanOut(kit, afterMove)).toBe(false);
  });
});

describe('compiled output matches core OutputConfig shape', () => {
  it('emits exactly the OutputConfig fields core consumes (segments on the output, D1)', () => {
    const cfgs: OutputConfig[] = patchToOutputs({ outputs: [output('o1', [h('A', 1), h('A', 2)])] });
    expect(cfgs).toEqual([
      {
        id: 'o1',
        channelsPerPixel: 3,
        segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 2 }],
      },
    ]);
  });
});
