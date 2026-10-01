import { describe, expect, it } from 'vitest';
import {
  FREE_MS,
  HOOP_KEYS,
  NO_DIVISION,
  RATE_KEYS,
  NO_REGION,
  aroundLabel,
  hasRegion,
  regionFromBounds,
  sliceOnOf,
  divisionLabel,
  effectiveOrder,
  sequenceOf,
  showAround,
  showThroughDrum,
  showThroughKit,
  slotsAtCount,
  spliceCountOf,
  targetDrumCount,
  throughKitLayer,
  timingActive,
  timingPatch,
  timingValue,
} from './splice-face';

/* The Splice card's decisions, ported from the graph inspector's `splice-options.ts` (Tim,
   2026-10-01: "bring it back as close to that version"). */

describe('a timing: one dropdown of divisions + Free (ms)', () => {
  it('shows Free while the mode is time, else the division (or the fallback)', () => {
    expect(timingValue({ rateMode: 'time', division: '1/4' }, RATE_KEYS, '1/8')).toBe(FREE_MS);
    expect(timingValue({ division: '1/4' }, RATE_KEYS, '1/8')).toBe('1/4');
    expect(timingValue({}, RATE_KEYS, '1/8')).toBe('1/8');
  });

  it('Free flips only the mode (the division survives); a division sets both', () => {
    expect(timingPatch(FREE_MS, RATE_KEYS)).toEqual({ rateMode: 'time' });
    expect(timingPatch('1/4', RATE_KEYS)).toEqual({ rateMode: 'beats', division: '1/4' });
  });

  it('a cascade is active with a division, or a free time above zero — not None', () => {
    expect(timingActive({}, HOOP_KEYS)).toBe(false);
    expect(timingActive({ offsetDivision: NO_DIVISION }, HOOP_KEYS)).toBe(false);
    expect(timingActive({ offsetDivision: '1/8' }, HOOP_KEYS)).toBe(true);
    expect(timingActive({ offsetMode: 'time', offsetMs: 0 }, HOOP_KEYS)).toBe(false);
    expect(timingActive({ offsetMode: 'time', offsetMs: 120 }, HOOP_KEYS)).toBe(true);
  });

  it('reads divisions as the inspector did', () => {
    expect(['1-bar', '2-bars', 'dotted-1/8', 'triplet-1/4', '1/16'].map(divisionLabel)).toEqual(['1 bar', '2 bars', '1/8 dotted', '1/4 triplet', '1/16']);
  });
});

describe('MOVE THROUGH', () => {
  it('THROUGH KIT is the primary axis on a drum cut, the drum axis otherwise', () => {
    expect(throughKitLayer('drum')).toMatchObject({ pattern: 'order', keys: { division: 'offsetDivision' } });
    expect(throughKitLayer('hoop')).toMatchObject({ pattern: 'drumOrder', keys: { division: 'drumOffsetDivision' } });
  });

  it('shows each layer only where it can send light', () => {
    expect(showThroughKit('hoop', 4)).toBe(true);
    expect(showThroughKit('hoop', 1)).toBe(false); // one drum: nowhere to send it
    expect(showThroughKit('scope', 4)).toBe(false);
    expect(showThroughDrum('hoop')).toBe(true);
    expect(showThroughDrum('drum')).toBe(false);
    expect(showAround('lit')).toBe(false);
    expect(showAround('dark')).toBe(true);
    expect([aroundLabel('hoop'), aroundLabel('drum'), aroundLabel('scope')]).toEqual(['AROUND HOOP', 'AROUND DRUM', 'ALONG THE CUT']);
  });

  it('counts the drums the Target lights', () => {
    expect(targetDrumCount({ kind: 'kit' }, 4)).toBe(4);
    expect(targetDrumCount({ kind: 'hitDrum' }, 4)).toBe(1);
    expect(targetDrumCount({ kind: 'select', drums: [{}, {}] }, 4)).toBe(2);
  });

  it('a dragged sequence wins over the pattern; missing ids are appended', () => {
    const ids = ['kick', 'snare', 'tom1'];
    expect(effectiveOrder(ids, sequenceOf({ drumSequence: 'tom1, kick' }, 'drumSequence'), 'up', 1)).toEqual(['tom1', 'kick', 'snare']);
    expect(effectiveOrder(ids, [], 'down', 1)).toEqual(['tom1', 'snare', 'kick']);
    expect(sequenceOf({ drumSequence: '' }, 'drumSequence')).toEqual([]);
  });
});

describe('the Splices rows', () => {
  it('are exactly Count rows, cycling the authored slots; blank with none', () => {
    expect(slotsAtCount([{ color: 'r' }, { color: 'b' }], 5).map((s) => s.color)).toEqual(['r', 'b', 'r', 'b', 'r']);
    expect(slotsAtCount([{ color: 'r' }, { color: 'b' }, { color: 'g' }], 2).map((s) => s.color)).toEqual(['r', 'b']);
    expect(slotsAtCount([], 3)).toEqual([{}, {}, {}]);
  });

  it('a cycled row is a copy, not the same object', () => {
    const slots = [{ color: 'r' }];
    expect(slotsAtCount(slots, 2)[1]).not.toBe(slots[0]);
  });

  it('Count clamps as the engine does', () => {
    expect([spliceCountOf({}), spliceCountOf({ count: 0 }), spliceCountOf({ count: 99 }), spliceCountOf({ count: 6.4 })]).toEqual([4, 1, 64, 6]);
  });
});

describe('Slice: what it cuts', () => {
  it('reads On from the Target and the Space box', () => {
    const box = regionFromBounds({ min: { x: -100, y: 0, z: -50 }, max: { x: 300, y: 200, z: 50 } });
    expect(box).toEqual({ regionCx: 100, regionCy: 100, regionCz: 0, regionSx: 400, regionSy: 200, regionSz: 100 });
    expect(sliceOnOf({ kind: 'kit' }, {})).toBe('kit');
    expect(sliceOnOf({ kind: 'hitDrum' }, {})).toBe('drum');
    expect(sliceOnOf({ kind: 'select' }, {})).toBe('drum');
    expect(sliceOnOf({ kind: 'kit' }, box)).toBe('space');
    expect(hasRegion({ ...box, regionSz: undefined as never })).toBe(false);
    expect(Object.values(NO_REGION).every((v) => v === undefined)).toBe(true);
  });
});
