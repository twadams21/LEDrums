import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import type { EffectsAuthoringApi, GridRow } from '../../../../trigger-lab/effects-api';
import {
  ampLengthFor,
  ampLengthMode,
  ampPath,
  clockEveryFromValue,
  clockEveryOptions,
  clockEveryValue,
  defaultTrigger,
  drumHoopCount,
  effectDisplayName,
  gapAt,
  gapToIndex,
  nudgeIndex,
  parseMidi,
  targetForKind,
  targetHoopOn,
  toggleTargetDrum,
  toggleTargetHoop,
  triggerKindOptions,
} from './strip-model';

const drums: GridRow[] = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'tom1', label: 'Tom 1' },
];
const fx = (input: Partial<effectChain.EffectInput> = {}) =>
  effectChain.parseEffect({ id: 'e', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' }, ...input });

describe('reorder gaps', () => {
  it('maps a drop gap to the final index the move ops take', () => {
    expect(gapToIndex(0, 3, 3)).toBe(2); // first → after last
    expect(gapToIndex(2, 0, 3)).toBe(0); // last → before first
    expect(gapToIndex(0, 2, 3)).toBe(1);
  });
  it('is null when the drop leaves the item in place or the source is out of range', () => {
    expect(gapToIndex(1, 1, 3)).toBeNull();
    expect(gapToIndex(1, 2, 3)).toBeNull();
    expect(gapToIndex(5, 0, 3)).toBeNull();
  });
  it('clamps an out-of-range gap', () => {
    expect(gapToIndex(0, 99, 3)).toBe(2);
  });
  it('nudges one step and stops at either end', () => {
    expect(nudgeIndex(1, 1, 3)).toBe(2);
    expect(nudgeIndex(0, -1, 3)).toBeNull();
    expect(nudgeIndex(2, 1, 3)).toBeNull();
  });
  it('picks the gap by the pointer side of the item midpoint', () => {
    expect(gapAt(2, 10, 0, 40)).toBe(2);
    expect(gapAt(2, 30, 0, 40)).toBe(3);
  });
});

describe('Trigger card model', () => {
  it('disables the zone kind on the Kit row only', () => {
    expect(triggerKindOptions('kit').find((o) => o.value === 'zone')?.disabled).toBe(true);
    expect(triggerKindOptions('kick').find((o) => o.value === 'zone')?.disabled).toBe(false);
  });
  it('switches kind to the schema defaults', () => {
    expect(defaultTrigger('clock')).toEqual({ kind: 'clock', every: { beats: 1 }, offsetBeats: 0 });
    expect(defaultTrigger('cue')).toEqual({ kind: 'cue', source: {} });
  });
  it('round-trips clock periods and keeps an authored period the list lacks', () => {
    expect(clockEveryFromValue(clockEveryValue({ bars: 2 }))).toEqual({ bars: 2 });
    expect(clockEveryFromValue(clockEveryValue({ beats: 0.5 }))).toEqual({ beats: 0.5 });
    const odd = clockEveryOptions({ beats: 3 });
    expect(odd.at(-1)).toEqual({ value: 'b3', label: '3 beats' });
    expect(clockEveryFromValue('b3')).toEqual({ beats: 3 });
    expect(clockEveryFromValue('x')).toBeNull();
  });
  it('parses MIDI entries: blank clears, out of range is rejected', () => {
    expect(parseMidi('')).toBeUndefined();
    expect(parseMidi('36')).toBe(36);
    expect(parseMidi('128')).toBeNull();
    expect(parseMidi('1.5')).toBeNull();
  });
});

describe('amp envelope model', () => {
  it('reads and switches the gate length mode', () => {
    expect(ampLengthMode({ ms: 200 })).toBe('ms');
    expect(ampLengthMode({ beats: 2 })).toBe('beats');
    expect(ampLengthMode('hold')).toBe('hold');
    expect(ampLengthFor('beats', { ms: 200 })).toEqual({ beats: 1 });
    expect(ampLengthFor('ms', { ms: 200 })).toEqual({ ms: 200 });
    expect(ampLengthFor('loop', { ms: 200 })).toBe('loop');
  });
  it('draws an outline that starts and ends on the baseline', () => {
    const path = ampPath(fx().amp, 200, 36);
    expect(path.startsWith('M2.0 34.0')).toBe(true);
    expect(path.endsWith(' 34.0')).toBe(true);
  });
});

describe('Target card model', () => {
  it('Select starts from the row drum, or every drum on the Kit row', () => {
    expect(targetForKind('select', fx(), drums)).toEqual({ kind: 'select', drums: [{ drumId: 'kick' }] });
    const kit = fx({ cell: { row: 'kit', column: { kind: 'always' } } });
    expect(targetForKind('select', kit, drums)).toEqual({
      kind: 'select',
      drums: [{ drumId: 'kick' }, { drumId: 'snare' }, { drumId: 'tom1' }],
    });
    expect(targetForKind('hitDrum', fx(), drums)).toEqual({ kind: 'hitDrum' });
  });
  it('toggles drums in kit order', () => {
    const t = toggleTargetDrum({ kind: 'select', drums: [{ drumId: 'tom1' }] }, 'kick', drums);
    expect(t.drums.map((d) => d.drumId)).toEqual(['kick', 'tom1']);
    expect(toggleTargetDrum(t, 'tom1', drums).drums.map((d) => d.drumId)).toEqual(['kick']);
  });
  it('narrows a whole drum to hoops and returns to whole when all or none are lit', () => {
    const whole = { kind: 'select' as const, drums: [{ drumId: 'kick' }] };
    const narrowed = toggleTargetHoop(whole, 'kick', 2, 4);
    expect(narrowed.drums[0]).toEqual({ drumId: 'kick', hoops: [1, 3, 4] });
    expect(targetHoopOn(narrowed, 'kick', 2)).toBe(false);
    expect(toggleTargetHoop(narrowed, 'kick', 2, 4).drums[0]).toEqual({ drumId: 'kick' });
    const one = { kind: 'select' as const, drums: [{ drumId: 'kick', hoops: [3] }] };
    expect(toggleTargetHoop(one, 'kick', 3, 4).drums[0]).toEqual({ drumId: 'kick' });
  });
});

describe('strip helpers', () => {
  it('falls back to the Generator label for an unnamed Effect', () => {
    expect(effectDisplayName(fx({ name: '' }))).toBe('Solid');
    expect(effectDisplayName(fx({ name: 'Hit' }))).toBe('Hit');
  });
  it('reads hoop counts only from a host that offers them', () => {
    expect(drumHoopCount({} as EffectsAuthoringApi, 'kick')).toBe(0);
    const api = { drumHoopCount: (id: string) => (id === 'kick' ? 4 : -1) } as unknown as EffectsAuthoringApi;
    expect(drumHoopCount(api, 'kick')).toBe(4);
    expect(drumHoopCount(api, 'snare')).toBe(0);
  });
});
