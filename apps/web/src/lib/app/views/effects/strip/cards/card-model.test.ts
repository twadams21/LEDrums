import { describe, expect, it } from 'vitest';
import { effectChain, tryGetModifier } from '@ledrums/core';
import {
  adsrPath,
  describeMapping,
  describeSlot,
  envelopePoints,
  envelopeShapeOf,
  formatParam,
  generatorParams,
  isLandscape,
  mappingTargets,
  modulatedKeys,
  paramColumns,
  paramSections,
  paramsLandscape,
  paramValue,
  sectionColumns,
  parseMapTargetKey,
  mapTargetKey,
  slotGeneratorOptions,
  styleOptions,
  thumbSource,
  type CardParam,
} from './card-model';

const fx = (extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id: 'e1', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'wave', style: 'radial' }, ...extra });

const keys = (ps: CardParam[]) => ps.map((p) => p.key);

describe('generatorParams — what the Generator card shows', () => {
  it('is the Style’s param spec from core for an ordinary Generator', () => {
    const device = fx().generator;
    expect(keys(generatorParams(device))).toEqual(effectChain.generatorParamSpec('wave', 'radial').map((s) => s.key));
    expect(generatorParams(device).length).toBeGreaterThan(0);
  });

  it('shows the beats rate and hides the ms rate while the splice rate mode is beats', () => {
    const shown = keys(generatorParams({ kind: 'splice', style: '', params: { chase: 'step', rateMode: 'beats' } }));
    expect(shown).toContain('division');
    expect(shown).not.toContain('rateMs');
  });

  it('swaps to the ms rate when the splice rate mode is time', () => {
    const shown = keys(generatorParams({ kind: 'splice', style: '', params: { chase: 'step', rateMode: 'time' } }));
    expect(shown).toContain('rateMs');
    expect(shown).not.toContain('division');
  });

  it('hides the motion settings while a splice does not move (the default)', () => {
    const shown = keys(generatorParams({ kind: 'splice', style: '', params: {} }));
    expect(shown).toContain('count');
    for (const k of ['rateMode', 'division', 'rateMs', 'direction', 'incrementPx']) expect(shown).not.toContain(k);
  });

  it('shows the stagger only in Stagger motion, and Slice drops the hoop partition', () => {
    expect(keys(generatorParams({ kind: 'splice', style: '', params: { chase: 'stagger' } }))).toContain('incrementPx');
    const slice = keys(generatorParams({ kind: 'slice', style: '', params: { chase: 'stagger' } }));
    expect(slice).toContain('incrementPct');
    expect(slice).toContain('axis');
    expect(slice).not.toContain('partition');
  });

  it('gives Splice / Slice no Style choices and no thumbnail source', () => {
    expect(styleOptions('splice')).toEqual([]);
    expect(thumbSource({ kind: 'splice', style: '', params: {} })).toBeNull();
  });

  it('resolves the thumbnail to the hosted effect, and to nothing for an unknown Style', () => {
    expect(thumbSource(fx().generator)?.generatorId).toBe('radial-wash');
    expect(thumbSource({ kind: 'wave', style: 'no-such-style', params: {} })).toBeNull();
  });
});

describe('param values and read-outs', () => {
  const num: CardParam = { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, step: 0.01, unit: '×', default: 1 };
  const ms: CardParam = { key: 'life', label: 'Life', kind: 'number', min: 0, max: 5000, step: 1, unit: 'ms', default: 500 };
  const choice: CardParam = { key: 'order', label: 'Order', kind: 'enum', options: ['up', 'outside-in'], default: 'up' };

  it('falls back to the spec default for an unwritten or invalid value', () => {
    expect(paramValue(num, {})).toBe(1);
    expect(paramValue(choice, { order: 'sideways' })).toBe('up');
    expect(paramValue(choice, { order: 'outside-in' })).toBe('outside-in');
  });

  it('formats by step and unit: symbols hug, words are spaced', () => {
    expect(formatParam(num, 1.5)).toBe('1.50×');
    expect(formatParam(ms, 250.4)).toBe('250 ms');
    expect(formatParam(choice, 'outside-in')).toBe('Outside in');
    expect(formatParam(ms, 250.4, { unit: false })).toBe('250');
  });
});

describe('modulation', () => {
  const withControls = () => {
    const base = fx({
      modifiers: [
        { uid: 'm1', modifierId: 'strobe' },
        { uid: 'm2', modifierId: 'strobe' },
      ],
    });
    return effectChain.parseEffect({
      ...base,
      controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'generator', param: 'speed' }, { device: 'm2', param: 'rate' }] }],
    });
  };

  it('marks exactly the params a control drives, per device', () => {
    const e = withControls();
    expect([...modulatedKeys(e, 'generator')]).toEqual(['speed']);
    expect([...modulatedKeys(e, 'm2')]).toEqual(['rate']);
    expect(modulatedKeys(e, 'm1').size).toBe(0);
    expect(modulatedKeys(undefined, 'generator').size).toBe(0);
  });

  it('offers only numeric params as mapping targets, numbering repeated modifiers', () => {
    const targets = mappingTargets(withControls());
    expect(targets.every((t) => typeof t.min === 'number' && typeof t.max === 'number')).toBe(true);
    const devices = new Set(targets.map((t) => t.device));
    expect(devices).toEqual(new Set(['generator', 'm1', 'm2']));
    expect(targets.find((t) => t.device === 'm1')!.label.startsWith('Strobe · ')).toBe(true);
    expect(targets.find((t) => t.device === 'm2')!.label.startsWith('Strobe 2 · ')).toBe(true);
    const nonNumeric = (tryGetModifier('strobe')?.paramSpec ?? []).filter((p) => p.type !== 'number').map((p) => p.key);
    expect(nonNumeric.length).toBeGreaterThan(0);
    expect(targets.some((t) => t.device === 'm1' && nonNumeric.includes(t.param))).toBe(false);
  });

  it('labels a mapping whose device left the Effect as missing', () => {
    const e = withControls();
    expect(describeMapping(e, { device: 'gone', param: 'rate', amount: 1, invert: false })).toBe('Missing · rate');
  });

  it('round-trips a target key', () => {
    expect(parseMapTargetKey(mapTargetKey('m2', 'rate'))).toEqual({ device: 'm2', param: 'rate' });
    expect(parseMapTargetKey('nonsense')).toBeNull();
  });
});

describe('Envelope control shapes', () => {
  it('stores Decay as absent points and reads it back', () => {
    expect(envelopePoints('decay')).toBeUndefined();
    expect(envelopeShapeOf(undefined)).toBe('decay');
  });

  it('round-trips every preset and calls anything else custom', () => {
    for (const s of ['rise', 'pluck', 'pulse'] as const) expect(envelopeShapeOf(envelopePoints(s))).toBe(s);
    expect(envelopeShapeOf([{ t: 0, v: 0.3 }, { t: 1, v: 0.9 }])).toBe('custom');
  });
});

describe('modifier envelope plot', () => {
  it('rises to the top, settles at the sustain level and returns to the floor', () => {
    const d = adsrPath({ attackMs: 100, decayMs: 100, sustainLevel: 0.5, releaseMs: 100 }, 100, 20);
    expect(d.startsWith('M0 20 ')).toBe(true);
    expect(d).toContain(' 0 L'); // the attack peak at y = 0
    expect(d).toContain(' 10 L'); // sustain at half height
    expect(d.endsWith('L100 20')).toBe(true);
  });
});

describe('splice slots', () => {
  it('never offers a nested Splice / Slice', () => {
    const kinds = slotGeneratorOptions().map((o) => o.value);
    expect(kinds).not.toContain('splice');
    expect(kinds).not.toContain('slice');
    expect(kinds).toContain('wave');
  });

  it('describes a slot by what it shows', () => {
    expect(describeSlot({})).toBe('Blank');
    expect(describeSlot({ muted: true, color: '#ff0000' })).toBe('Off');
    expect(describeSlot({ color: '#ff0000' })).toBe('#FF0000');
    expect(describeSlot({ color: '#ff0000', generator: { kind: 'wave', style: 'radial', params: {} } })).toBe('Wave · Radial, tinted');
  });
});

describe('paramColumns — landscape cards (Tim, 2026-10-01: at most 12 rows down, then across)', () => {
  it('keeps up to 12 rows in one column', () => {
    expect(paramColumns(0)).toEqual({ columns: 1, rows: 1 });
    expect(paramColumns(12)).toEqual({ columns: 1, rows: 12 });
    expect(isLandscape(12)).toBe(false);
  });

  it('past 12, uses as few columns as keep each at 12 or under, spread evenly', () => {
    expect(paramColumns(13)).toEqual({ columns: 2, rows: 7 });
    expect(paramColumns(22)).toEqual({ columns: 2, rows: 11 }); // Splice: two columns, not three
    expect(paramColumns(30)).toEqual({ columns: 3, rows: 10 });
    expect(isLandscape(13)).toBe(true);
  });
});

describe('param sections — capitalised headers (Tim, 2026-10-04)', () => {
  const p = (key: string, section?: string): CardParam => ({ key, label: key, kind: 'number', default: 0, ...(section ? { section } : {}) });

  it('groups params by their section, in order; no sections → null', () => {
    expect(paramSections([p('a'), p('b')])).toBeNull();
    const s = paramSections([p('a', 'Dots'), p('b', 'Dots'), p('c', 'Shape'), p('d')])!;
    expect(s.map((x) => [x.label, keys(x.params)])).toEqual([['Dots', ['a', 'b']], ['Shape', ['c', 'd']]]);
  });

  it('short sections share a column (a header counts as a line); a full one starts the next', () => {
    const sec = (label: string, n: number) => ({ label, params: Array.from({ length: n }, (_, k) => p(`${label}${k}`, label)) });
    const cols = sectionColumns([sec('A', 7), sec('B', 5), sec('C', 4), sec('D', 6), sec('E', 3)]);
    expect(cols.map((c) => c.map((x) => x.label))).toEqual([['A', 'B'], ['C', 'D'], ['E']]);
  });

  it('the Dot card: eight sections in four columns, landscape', () => {
    const params = generatorParams(effectChain.parseEffect({ id: 'd', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'dot', style: 'dot' } }).generator);
    const cols = sectionColumns(paramSections(params)!);
    expect(cols.map((c) => c.map((x) => x.label))).toEqual([
      ['Dots', 'Life'], ['Shape', 'Move around'], ['Move through', 'Colour'], ['Background', 'Velocity'],
    ]);
    expect(paramsLandscape(params)).toBe(true);
    expect(params.find((x) => x.key === 'maxLive')).toMatchObject({ label: 'Max alive', info: expect.stringContaining('most dots alive') });
    // A 0..1 amount with a `%` unit reads as a whole percent.
    expect(params.find((x) => x.key === 'fade')).toMatchObject({ percent: true });
    expect(params.find((x) => x.key === 'count')?.percent).toBeUndefined();
  });
});
