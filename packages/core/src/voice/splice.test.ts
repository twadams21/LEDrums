import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import {
  DEFAULT_SPLICE_ATTACK_MS,
  DEFAULT_SPLICE_COUNT,
  DEFAULT_SPLICE_HOLD_MS,
  DEFAULT_SPLICE_INCREMENT_PX,
  DEFAULT_SPLICE_RELEASE_MS,
  MAX_SPLICE_COUNT,
  MAX_SPLICE_INCREMENT_PX,
  SPLICE_FILL_EFFECT_ID,
  chasePixelShift,
  chaseStaggerShift,
  chaseStepOffset,
  computeSpliceBands,
  forEachPartitionUnit,
  forEachSpliceBand,
  forEachSpliceSegment,
  isBlankSplice,
  resolveSplices,
  spliceDefAt,
  spliceFeatherPx,
  spliceOrderIndex,
  tintPixel,
  unitMotionAge,
  wrapIndex,
} from './splice';
import type { GraphNode, SpliceDef } from './types';

function spliceNode(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 's1',
    kind: 'splice',
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

const widths = (len: number, count: number, jitter = 0, seed = 1): number[] =>
  computeSpliceBands(len, count, jitter, seed).map((b) => b.width);

describe('computeSpliceBands', () => {
  it('covers the run exactly — widths sum to len and bands are contiguous', () => {
    for (const len of [1, 7, 16, 29, 108, 196]) {
      for (const count of [1, 2, 3, 5, 8, 13]) {
        for (const jitter of [0, 0.35, 1]) {
          const bands = computeSpliceBands(len, count, jitter, 42);
          expect(bands, `${len}/${count}/${jitter}`).toHaveLength(count);
          expect(bands.reduce((n, b) => n + b.width, 0), `${len}/${count}/${jitter}`).toBe(len);
          let cursor = 0;
          for (const band of bands) {
            expect(band.start).toBe(cursor);
            expect(band.width).toBeGreaterThanOrEqual(0);
            cursor += band.width;
          }
          expect(cursor).toBe(len);
        }
      }
    }
  });

  it('cuts even bands with no jitter, and absorbs the remainder rather than losing it', () => {
    expect(widths(16, 4)).toEqual([4, 4, 4, 4]);
    // 10/4 = 2.5 — the cumulative-boundary walk alternates 3/2 and still totals 10.
    expect(widths(10, 4).reduce((a, b) => a + b, 0)).toBe(10);
    expect(widths(10, 4).every((w) => w === 2 || w === 3)).toBe(true);
  });

  it('is deterministic in (len, count, jitter, seed), and the seed actually changes the cut', () => {
    expect(widths(64, 6, 0.8, 7)).toEqual(widths(64, 6, 0.8, 7));
    expect(widths(64, 6, 0.8, 7)).not.toEqual(widths(64, 6, 0.8, 8));
    // Same seed, no jitter → the seed is irrelevant, as an author would expect.
    expect(widths(64, 6, 0, 7)).toEqual(widths(64, 6, 0, 99));
  });

  it('jitter makes splice lengths genuinely uneven', () => {
    const uneven = new Set(widths(120, 6, 0.9, 3));
    expect(uneven.size).toBeGreaterThan(1);
  });

  it('survives degenerate runs: no pixels, and more splices than pixels', () => {
    expect(widths(0, 4)).toEqual([0, 0, 0, 0]);
    const tight = computeSpliceBands(3, 8, 0, 1);
    expect(tight).toHaveLength(8);
    expect(tight.reduce((n, b) => n + b.width, 0)).toBe(3);
    expect(tight.some((b) => b.width === 0)).toBe(true);
  });

  it('clamps the count into the authorable range', () => {
    expect(computeSpliceBands(32, 0, 0, 1)).toHaveLength(1);
    expect(computeSpliceBands(32, -5, 0, 1)).toHaveLength(1);
    expect(computeSpliceBands(4096, 999, 0, 1)).toHaveLength(MAX_SPLICE_COUNT);
  });
});

describe('slot helpers', () => {
  it('wraps negative indices instead of keeping the sign (a −1 chase must reach the last slot)', () => {
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(-5, 4)).toBe(3);
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(2, 0)).toBe(0);
  });

  it('cycles fewer authored splices across more slots', () => {
    const defs: SpliceDef[] = [{ color: '#ff0000' }, { color: '#0000ff' }];
    expect(spliceDefAt(defs, 0)?.color).toBe('#ff0000');
    expect(spliceDefAt(defs, 1)?.color).toBe('#0000ff');
    expect(spliceDefAt(defs, 2)?.color).toBe('#ff0000');
    expect(spliceDefAt(defs, 7)?.color).toBe('#0000ff');
    expect(spliceDefAt([], 0)).toBeUndefined();
    expect(spliceDefAt(undefined, 0)).toBeUndefined();
  });

  it('treats muted and empty splices as blank, and colour-or-effect as content', () => {
    expect(isBlankSplice(undefined)).toBe(true);
    expect(isBlankSplice({})).toBe(true);
    expect(isBlankSplice({ color: null })).toBe(true);
    expect(isBlankSplice({ color: '' })).toBe(true);
    expect(isBlankSplice({ color: '#ff0000', muted: true })).toBe(true);
    expect(isBlankSplice({ effectId: 'comet-trails', muted: true })).toBe(true);
    expect(isBlankSplice({ color: '#ff0000' })).toBe(false);
    expect(isBlankSplice({ effectId: 'comet-trails' })).toBe(false);
  });
});

describe('chase', () => {
  it('steps one splice per interval, and honours direction', () => {
    expect(chaseStepOffset(0, 250, 1)).toBe(0);
    expect(chaseStepOffset(249, 250, 1)).toBe(0);
    expect(chaseStepOffset(250, 250, 1)).toBe(1);
    expect(chaseStepOffset(1000, 250, 1)).toBe(4);
    expect(chaseStepOffset(1000, 250, -1)).toBe(-4);
  });

  it('freezes when the rate is off or the age is nonsense', () => {
    expect(chaseStepOffset(1000, 0, 1)).toBe(0);
    expect(chaseStepOffset(1000, -5, 1)).toBe(0);
    expect(chaseStepOffset(-10, 250, 1)).toBe(0);
    expect(chaseStepOffset(Number.NaN, 250, 1)).toBe(0);
    expect(chasePixelShift(1000, 0, 1, 32)).toBe(0);
    expect(chasePixelShift(1000, 250, 1, 0)).toBe(0);
  });

  it('slides exactly one full lap per interval in smooth mode', () => {
    expect(chasePixelShift(250, 250, 1, 32)).toBe(32);
    expect(chasePixelShift(125, 250, 1, 32)).toBe(16);
    expect(chasePixelShift(125, 250, -1, 32)).toBe(-16);
  });

  it('jumps a whole increment per interval in stagger mode, and nothing in between', () => {
    expect(chaseStaggerShift(0, 250, 1, 4)).toBe(0);
    expect(chaseStaggerShift(249, 250, 1, 4), 'mid-interval it has not moved at all').toBe(0);
    expect(chaseStaggerShift(250, 250, 1, 4)).toBe(4);
    expect(chaseStaggerShift(499, 250, 1, 4), 'still on the first step').toBe(4);
    expect(chaseStaggerShift(1000, 250, 1, 4)).toBe(16);
    expect(chaseStaggerShift(1000, 250, -1, 4)).toBe(-16);
  });

  it('staggers by the authored pixels regardless of how long the run is — unlike a smooth lap', () => {
    // The same elapsed time on a 34px hoop and a 196px kick: a lap-based spin covers wildly
    // different pixel counts, a stagger covers the same 6px. That difference IS the mode.
    expect(chasePixelShift(500, 250, 1, 34)).not.toBe(chasePixelShift(500, 250, 1, 196));
    expect(chaseStaggerShift(500, 250, 1, 6)).toBe(12);
  });

  it('freezes a stagger on a zero increment or an off rate rather than dividing by nothing', () => {
    expect(chaseStaggerShift(1000, 250, 1, 0)).toBe(0);
    expect(chaseStaggerShift(1000, 250, 1, -5)).toBe(0);
    expect(chaseStaggerShift(1000, 0, 1, 4)).toBe(0);
    expect(chaseStaggerShift(-10, 250, 1, 4)).toBe(0);
    expect(chaseStaggerShift(Number.NaN, 250, 1, 4)).toBe(0);
  });

  it('rounds a fractional increment to whole pixels — a stagger lands on pixel boundaries', () => {
    expect(chaseStaggerShift(250, 250, 1, 3.4)).toBe(3);
    expect(chaseStaggerShift(250, 250, 1, 3.6)).toBe(4);
  });
});

describe('forEachSpliceBand', () => {
  const collect = (bands: { start: number; width: number }[], len: number, shift: number, offset: number) => {
    const out: { slot: number; start: number; end: number }[] = [];
    forEachSpliceBand(bands, len, shift, offset, (slot, start, end) => out.push({ slot, start, end }));
    return out;
  };

  it('maps band → slot one-to-one when nothing is chasing', () => {
    const bands = computeSpliceBands(16, 4, 0, 1);
    expect(collect(bands, 16, 0, 0)).toEqual([
      { slot: 0, start: 0, end: 4 },
      { slot: 1, start: 4, end: 8 },
      { slot: 2, start: 8, end: 12 },
      { slot: 3, start: 12, end: 16 },
    ]);
  });

  it('step chase rotates the CONTENT and leaves the band geometry alone', () => {
    const bands = computeSpliceBands(16, 4, 0, 1);
    const stepped = collect(bands, 16, 0, 1);
    expect(stepped.map((b) => [b.start, b.end])).toEqual([[0, 4], [4, 8], [8, 12], [12, 16]]);
    // Every band now shows the splice one slot back — that IS the chase.
    expect(stepped.map((b) => b.slot)).toEqual([3, 0, 1, 2]);
    expect(collect(bands, 16, 0, -1).map((b) => b.slot)).toEqual([1, 2, 3, 0]);
  });

  it('smooth chase slides the geometry and splits the band that crosses the wrap point', () => {
    const bands = computeSpliceBands(16, 4, 0, 1);
    const slid = collect(bands, 16, 2, 0);
    expect(slid.filter((b) => b.slot === 0)).toEqual([{ slot: 0, start: 2, end: 6 }]);
    // Band 3 (12..16) shifted by 2 runs 14..18 → emitted as 14..16 plus 0..2.
    expect(slid.filter((b) => b.slot === 3)).toEqual([
      { slot: 3, start: 14, end: 16 },
      { slot: 3, start: 0, end: 2 },
    ]);
    // Still exactly one band's worth of pixels per slot, wrap or no wrap.
    const covered = slid.reduce((n, b) => n + (b.end - b.start), 0);
    expect(covered).toBe(16);
  });

  it('emits nothing for zero-width bands or an empty run', () => {
    expect(collect(computeSpliceBands(3, 8, 0, 1), 3, 0, 0).every((b) => b.end > b.start)).toBe(true);
    expect(collect(computeSpliceBands(16, 4, 0, 1), 0, 0, 0)).toEqual([]);
    expect(collect([], 16, 0, 0)).toEqual([]);
  });
});

describe('smudge', () => {
  const bands = (len: number, count: number) => computeSpliceBands(len, count, 0, 1);

  it('is a fraction of the average band width, so it reads the same on any run length', () => {
    expect(spliceFeatherPx(0.5, bands(32, 4), 32)).toBe(4); // half of 32/4
    expect(spliceFeatherPx(0.5, bands(160, 4), 160)).toBe(20);
    expect(spliceFeatherPx(0, bands(32, 4), 32)).toBe(0);
  });

  it('never exceeds the narrowest band — a wider feather would dip, not smudge', () => {
    const uneven = computeSpliceBands(64, 6, 0.9, 3);
    const narrowest = Math.min(...uneven.filter((b) => b.width > 0).map((b) => b.width));
    expect(spliceFeatherPx(1, uneven, 64)).toBeLessThanOrEqual(narrowest);
  });

  it('weights sum to 1 across every pixel of the run — no seam, no dip', () => {
    const len = 48;
    const b = bands(len, 4);
    for (const smudge of [0, 0.25, 0.5, 1]) {
      const total = new Array<number>(len).fill(0);
      forEachSpliceSegment(b, len, 0, 0, spliceFeatherPx(smudge, b, len), (_slot, start, end, w0, w1) => {
        const span = end - start;
        for (let i = 0; i < span; i++) total[start + i]! += span <= 1 ? w0 : w0 + (w1 - w0) * (i / span);
      });
      for (let p = 0; p < len; p++) expect(total[p], `smudge ${smudge} pixel ${p}`).toBeCloseTo(1, 5);
    }
  });

  it('with no smudge every pixel belongs to exactly ONE splice', () => {
    const len = 32;
    const b = bands(len, 4);
    const owners = new Array<number>(len).fill(0);
    forEachSpliceSegment(b, len, 0, 0, 0, (_slot, start, end) => {
      for (let p = start; p < end; p++) owners[p]! += 1;
    });
    expect(owners.every((n) => n === 1)).toBe(true);
  });

  it('blends across the wrap point too', () => {
    const len = 32;
    const b = bands(len, 4);
    const slots = new Map<number, Set<number>>();
    forEachSpliceSegment(b, len, 0, 0, spliceFeatherPx(1, b, len), (slot, start, end) => {
      for (let p = start; p < end; p++) (slots.get(p) ?? slots.set(p, new Set()).get(p)!).add(slot);
    });
    // Pixel 0 sits on the seam between the last splice and the first, so both reach it.
    expect(slots.get(0)!.size).toBe(2);
  });
});

describe('forEachPartitionUnit', () => {
  const model = buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 10, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
  const whole = [{ start: 0, end: model.pixelCount }];
  const collect = (partition: 'hoop' | 'drum' | 'scope', ranges = whole) => {
    const out: [number, number][] = [];
    forEachPartitionUnit(model, ranges, partition, (u) => out.push([u.start, u.end]));
    return out;
  };
  const ordinals = (partition: 'hoop' | 'drum' | 'scope') => {
    const out: [number, number][] = [];
    forEachPartitionUnit(model, whole, partition, (u) => out.push([u.ordinal, u.ordinalCount]));
    return out;
  };

  it('cuts the scope once, each drum, or every hoop', () => {
    expect(model.pixelCount).toBe(24); // kick 2×8 + snare 2×4
    expect(collect('scope')).toEqual([[0, 24]]);
    expect(collect('drum')).toEqual([[0, 16], [16, 24]]);
    expect(collect('hoop')).toEqual([[0, 8], [8, 16], [16, 20], [20, 24]]);
  });

  it('reports the drum axis alongside the hoop axis, so a kit-wide splice can travel drum to drum', () => {
    const out: [number, number][] = [];
    forEachPartitionUnit(model, whole, 'hoop', (u) => out.push([u.drumOrdinal, u.drumCount]));
    expect(out).toEqual([[0, 2], [0, 2], [1, 2], [1, 2]]); // kick's two hoops, then the snare's
  });

  it('numbers a hoop WITHIN ITS DRUM, so a kit-wide cascade climbs every drum in parallel', () => {
    // Two drums, two hoops each: ordinals 0,1 then 0,1 again — not 0,1,2,3 across the kit.
    expect(ordinals('hoop')).toEqual([[0, 2], [1, 2], [0, 2], [1, 2]]);
    expect(ordinals('drum')).toEqual([[0, 2], [1, 2]]);
    expect(ordinals('scope')).toEqual([[0, 1]]);
  });

  it('clips units to the voice’s own ranges, so an upstream Scope still narrows a splice', () => {
    expect(collect('hoop', [{ start: 16, end: 24 }])).toEqual([[16, 20], [20, 24]]);
    expect(collect('drum', [{ start: 0, end: 16 }])).toEqual([[0, 16]]);
    // A range covering half of one hoop yields just that half — never a unit outside it.
    expect(collect('hoop', [{ start: 4, end: 10 }])).toEqual([[4, 8], [8, 10]]);
  });
});

describe('spliceOrderIndex', () => {
  const positions = (count: number, order: 'up' | 'down' | 'outside-in' | 'random', seed = 1) =>
    Array.from({ length: count }, (_, i) => spliceOrderIndex(i, count, order, seed));

  it('climbs, descends, and works inward from both ends', () => {
    expect(positions(4, 'up')).toEqual([0, 1, 2, 3]);
    expect(positions(4, 'down')).toEqual([3, 2, 1, 0]);
    // 0, 3, 1, 2 fire in that sequence → hoop0 goes first, hoop3 second, hoop1 third.
    expect(positions(4, 'outside-in')).toEqual([0, 2, 3, 1]);
    expect(positions(5, 'outside-in')).toEqual([0, 2, 4, 3, 1]);
  });

  it('is a genuine permutation in every order, so no two units share a start time', () => {
    for (const order of ['up', 'down', 'outside-in', 'random'] as const) {
      for (const count of [1, 2, 3, 4, 5, 8]) {
        const p = positions(count, order);
        expect([...p].sort((a, b) => a - b), `${order}/${count}`).toEqual(Array.from({ length: count }, (_, i) => i));
      }
    }
  });

  it('shuffles deterministically per seed', () => {
    expect(positions(6, 'random', 3)).toEqual(positions(6, 'random', 3));
    expect(positions(6, 'random', 3)).not.toEqual(positions(6, 'random', 4));
  });

  it('clamps a nonsense ordinal or count rather than returning undefined', () => {
    expect(spliceOrderIndex(0, 1, 'up', 1)).toBe(0);
    expect(spliceOrderIndex(9, 4, 'up', 1)).toBe(3);
    expect(spliceOrderIndex(-2, 4, 'up', 1)).toBe(0);
    expect(spliceOrderIndex(0, 0, 'down', 1)).toBe(0);
  });
});

describe('unitMotionAge', () => {
  it('holds a unit at a standstill until its turn, then runs it on its own clock', () => {
    expect(unitMotionAge(500, 0), 'the first unit is never delayed').toBe(500);
    expect(unitMotionAge(100, 200), 'not started yet → frozen at 0, not dark').toBe(0);
    expect(unitMotionAge(200, 200), 'exactly at its start').toBe(0);
    expect(unitMotionAge(500, 200)).toBe(300);
    expect(unitMotionAge(500, 400)).toBe(100);
  });

  it('is the identity with no offset — the previous behaviour, byte for byte', () => {
    expect(unitMotionAge(750, 0)).toBe(750);
    expect(unitMotionAge(750, -5)).toBe(750);
  });
});

describe('tintPixel', () => {
  it('is the identity at amount 0', () => {
    expect(tintPixel(0.5, 0.25, 0.125, { r: 1, g: 0, b: 0 }, 0)).toEqual({ r: 0.5, g: 0.25, b: 0.125 });
  });

  it('recolours to the tint while keeping the source’s brightness', () => {
    const t = tintPixel(0.5, 0.5, 0.5, { r: 1, g: 0, b: 0 }, 1);
    expect(t.r).toBeCloseTo(0.5, 6); // peak preserved…
    expect(t.g).toBeCloseTo(0, 6); // …hue taken from the tint
    expect(t.b).toBeCloseTo(0, 6);
  });

  it('leaves a flat fill tinted with its OWN colour untouched (why colour splices need no branch)', () => {
    const t = tintPixel(1, 0, 0, { r: 1, g: 0, b: 0 }, 1);
    expect(t.r).toBeCloseTo(1, 6);
    expect(t.g).toBeCloseTo(0, 6);
    expect(t.b).toBeCloseTo(0, 6);
  });
});

describe('resolveSplices', () => {
  it('returns null when every splice is blank, so an empty splice node spawns no voice', () => {
    expect(resolveSplices(spliceNode({ splices: [] }), 120)).toBeNull();
    expect(resolveSplices(spliceNode({ splices: [{}, { muted: true }] }), 120)).toBeNull();
    expect(resolveSplices(spliceNode(), 120)).toBeNull();
  });

  it('hosts a colour-only splice on the solid-colour generator with its colour as a param', () => {
    const r = resolveSplices(spliceNode({ spliceCount: 2, splices: [{ color: '#ff0000' }, { color: '#0000ff' }] }), 120);
    expect(r).not.toBeNull();
    expect(r!.members).toHaveLength(2);
    expect(r!.members[0]!.effectId).toBe(SPLICE_FILL_EFFECT_ID);
    expect(r!.members[0]!.params.color).toBe('#ff0000');
    expect(r!.members[1]!.params.color).toBe('#0000ff');
    expect(r!.config.inputBySlot).toEqual([0, 1]);
    expect(r!.config.colors).toEqual(['#ff0000', '#0000ff']);
  });

  it('keeps an effect splice on its own effect and params, and carries the colour as a tint', () => {
    const r = resolveSplices(
      spliceNode({ spliceCount: 1, splices: [{ effectId: 'comet-trails', color: '#00ff00', params: { brightness: 0.5 } }] }),
      120,
    );
    expect(r!.members[0]!.effectId).toBe('comet-trails');
    expect(r!.members[0]!.params).toEqual({ brightness: 0.5 });
    expect(r!.members[0]!.params.color).toBeUndefined(); // the tint is layout, not an effect param
    expect(r!.config.colors[0]).toBe('#00ff00');
  });

  it('maps blank slots to −1 while keeping the surviving members densely indexed', () => {
    const r = resolveSplices(
      spliceNode({ spliceCount: 4, splices: [{ color: '#ff0000' }, {}, { color: '#0000ff', muted: true }, { effectId: 'plasma' }] }),
      120,
    );
    expect(r!.config.inputBySlot).toEqual([0, -1, -1, 1]);
    expect(r!.members.map((m) => m.slot)).toEqual([0, 3]);
    expect(r!.config.colors).toEqual(['#ff0000', null, '#0000ff', null]);
  });

  it('cycles fewer authored splices over more slots', () => {
    const r = resolveSplices(spliceNode({ spliceCount: 4, splices: [{ color: '#ff0000' }, { color: '#0000ff' }] }), 120);
    expect(r!.config.colors).toEqual(['#ff0000', '#0000ff', '#ff0000', '#0000ff']);
    expect(r!.config.inputBySlot).toEqual([0, 1, 2, 3]);
  });

  it('resolves a beats chase against bpm at eval time — the same maths the delay node uses', () => {
    const beats = (division: string, bpm: number) =>
      resolveSplices(
        spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'step', spliceRateMode: 'beats', spliceDivision: division }),
        bpm,
      )!.config.chaseMs;
    expect(beats('1/4', 120)).toBe(500);
    expect(beats('1/8', 120)).toBe(250);
    expect(beats('1/16', 120)).toBe(125);
    expect(beats('1/8', 60)).toBe(500);
    expect(beats('dotted-1/8', 120)).toBe(375);
    expect(beats('triplet-1/8', 120)).toBeCloseTo(166.67, 1);
  });

  it('takes a free-time rate verbatim, and reports 0 when the chase is off', () => {
    const cfg = (over: Partial<GraphNode>) =>
      resolveSplices(spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], ...over }), 120)!.config;
    expect(cfg({ spliceChase: 'smooth', spliceRateMode: 'time', spliceRateMs: 900 }).chaseMs).toBe(900);
    expect(cfg({ spliceChase: 'off', spliceRateMode: 'time', spliceRateMs: 900 }).chaseMs).toBe(0);
  });

  it('resolves the drum cascade independently of the hoop one', () => {
    const cfg = (over: Partial<GraphNode>) =>
      resolveSplices(spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'step', ...over }), 120)!.config;
    const both = cfg({
      spliceOffsetMode: 'time',
      spliceOffsetMs: 40,
      spliceDrumOffsetMode: 'time',
      spliceDrumOffsetMs: 250,
      spliceDrumOrder: 'down',
    });
    expect(both.offsetMs).toBe(40);
    expect(both.drumOffsetMs).toBe(250);
    expect(both.drumOrder).toBe('down');
    expect(cfg({}).drumOffsetMs, 'no drum cascade unless asked for').toBe(0);
  });

  it('resolves bar-length divisions against the time signature', () => {
    const bars = (division: string, beatsPerBar?: number) =>
      resolveSplices(
        spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'step', spliceRateMode: 'beats', spliceDivision: division }),
        120,
        beatsPerBar,
      )!.config.chaseMs;
    expect(bars('1/2')).toBe(1000);
    expect(bars('1-bar')).toBe(2000); // 4 beats at 120bpm
    expect(bars('2-bars')).toBe(4000);
    expect(bars('4-bars')).toBe(8000);
    expect(bars('1-bar', 3), 'a bar is shorter in 3/4').toBe(1500);
  });

  it('resolves the stagger increment, defaulted and clamped', () => {
    const cfg = (over: Partial<GraphNode>) =>
      resolveSplices(spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'stagger', ...over }), 120)!.config;
    expect(cfg({}).incrementPx).toBe(DEFAULT_SPLICE_INCREMENT_PX);
    expect(cfg({ spliceIncrementPx: 12 }).incrementPx).toBe(12);
    expect(cfg({ spliceIncrementPx: -4 }).incrementPx).toBe(0);
    expect(cfg({ spliceIncrementPx: 99999 }).incrementPx).toBe(MAX_SPLICE_INCREMENT_PX);
  });

  it('resolves the per-unit cascade offset from a division or free time', () => {
    const cfg = (over: Partial<GraphNode>) =>
      resolveSplices(spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'step', ...over }), 120)!.config;
    expect(cfg({ spliceOffsetMode: 'beats', spliceOffsetDivision: '1/8' }).offsetMs).toBe(250);
    expect(cfg({ spliceOffsetMode: 'time', spliceOffsetMs: 90 }).offsetMs).toBe(90);
    expect(cfg({ spliceOffsetMode: 'time', spliceOffsetMs: -40 }).offsetMs).toBe(0);
  });

  it('does NOT start a cascade just because an order was picked', () => {
    const cfg = resolveSplices(
      spliceNode({ spliceCount: 1, splices: [{ color: '#fff' }], spliceChase: 'step', spliceOrder: 'down' }),
      120,
    )!.config;
    expect(cfg.offsetMs, 'no division chosen → units still move together').toBe(0);
    expect(cfg.order).toBe('down');
  });

  it('keeps the offset when the motion is off — with a dark wait it is what makes light travel', () => {
    const cfg = resolveSplices(
      spliceNode({
        spliceCount: 1,
        splices: [{ color: '#fff' }],
        spliceChase: 'off',
        spliceWaitMode: 'dark',
        spliceOffsetMode: 'time',
        spliceOffsetMs: 300,
      }),
      120,
    )!.config;
    expect(cfg.offsetMs).toBe(300);
  });

  it('fills every default, so a splice node authored with nothing but content still resolves', () => {
    const cfg = resolveSplices(spliceNode({ splices: [{ color: '#ffffff' }] }), 120)!.config;
    expect(cfg.count).toBe(DEFAULT_SPLICE_COUNT);
    expect(cfg.partition).toBe('hoop');
    expect(cfg.jitter).toBe(0);
    expect(cfg.chase).toBe('off');
    expect(cfg.direction).toBe(1);
    expect(cfg.tint).toBe(1);
    expect(cfg.offsetMs).toBe(0);
    expect(cfg.order).toBe('up');
    expect(cfg.drumOffsetMs).toBe(0);
    expect(cfg.drumOrder).toBe('up');
    expect(cfg.smudge).toBe(0);
  });

  it('clamps out-of-range authored values rather than trusting them into the render loop', () => {
    const cfg = resolveSplices(
      spliceNode({ splices: [{ color: '#fff' }], spliceCount: 9999, spliceJitter: 4, spliceTint: -1, spliceDirection: -1 }),
      120,
    )!.config;
    expect(cfg.count).toBe(MAX_SPLICE_COUNT);
    expect(cfg.jitter).toBe(1);
    expect(cfg.tint).toBe(0);
    expect(cfg.direction).toBe(-1);
  });
});
