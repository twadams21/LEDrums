import { describe, expect, it } from 'vitest';
import { makeNode } from '../../trigger-lab/sim';
import type { EffectDef, GraphNode } from '../../trigger-lab/sim';
import { DIVISION_OPTS } from './node-options';
import { SPLICE_CHASE_HINTS, SPLICE_CHASE_OPTS, SPLICE_MOTION_MODE_HINTS, SPLICE_MOTION_MODE_OPTS, SPLICE_WAIT_MODE_HINTS, SPLICE_WAIT_MODE_OPTS, SPLICE_NO_EFFECT, describeSpliceRow, spliceEffectOptions, spliceRows } from './splice-options';

/* The Splice inspector's row derivation. The rows are what an author actually edits, so the
   thing worth pinning is that they show what will RENDER — including the slots currently
   served by the cycling fallback, which have no authored row of their own yet. */

const spliceNode = (over: Partial<GraphNode> = {}): GraphNode => makeNode('splice', 's1', 0, 0, over);

const effect = (id: string, name: string, playType?: EffectDef['playType']): EffectDef => ({
  id,
  name,
  generatorId: id,
  playType,
  busId: 'base',
  scope: 'kit',
  params: [],
  attackMs: 10,
  sustainMs: 100,
  releaseMs: 100,
});

describe('spliceRows', () => {
  it('returns exactly as many rows as there are bands, not as many as are authored', () => {
    expect(spliceRows(spliceNode({ splices: [{ color: '#ff0000' }], spliceCount: 4 }))).toHaveLength(4);
    expect(spliceRows(spliceNode({ splices: [{}, {}, {}], spliceCount: 2 }))).toHaveLength(2);
  });

  it('shows the cycling fallback for unauthored slots, and flags them as cycled', () => {
    const rows = spliceRows(spliceNode({ splices: [{ color: '#ff0000' }, { color: '#0000ff' }], spliceCount: 4 }));
    expect(rows.map((r) => r.color)).toEqual(['#ff0000', '#0000ff', '#ff0000', '#0000ff']);
    expect(rows.map((r) => r.cycled)).toEqual([false, false, true, true]);
  });

  it('reads colour, effect and mute off each slot, and marks the blank ones', () => {
    const rows = spliceRows(
      spliceNode({ splices: [{ color: '#ff0000' }, { effectId: 'fx' }, {}, { color: '#00ff00', muted: true }], spliceCount: 4 }),
    );
    expect(rows[0]).toMatchObject({ color: '#ff0000', effectId: null, muted: false, blank: false });
    expect(rows[1]).toMatchObject({ color: null, effectId: 'fx', muted: false, blank: false });
    expect(rows[2]).toMatchObject({ color: null, effectId: null, blank: true });
    expect(rows[3]).toMatchObject({ color: '#00ff00', muted: true, blank: true });
  });

  it('treats empty strings as absent, so a cleared field is not a colour of ""', () => {
    const rows = spliceRows(spliceNode({ splices: [{ color: '', effectId: '' }], spliceCount: 1 }));
    expect(rows[0]).toMatchObject({ color: null, effectId: null, blank: true });
  });

  it('falls back to the default count and survives a node with nothing authored', () => {
    const rows = spliceRows(spliceNode());
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.blank)).toBe(true);
  });

  it('clamps a count outside the authorable range', () => {
    expect(spliceRows(spliceNode({ spliceCount: 0 }))).toHaveLength(1);
    expect(spliceRows(spliceNode({ spliceCount: 5000 }))).toHaveLength(64);
  });
});

describe('spliceEffectOptions', () => {
  const effects = [
    effect('gen:plasma', 'Plasma', 'textures'),
    effect('gen:whole-drum', 'Whole Drum', 'hits'),
    effect('gen:comet', 'Comet Trails', 'particles'),
  ];

  it('offers "no effect" first — colour-only is the default thing a splice is', () => {
    const opts = spliceEffectOptions(effects);
    expect(opts[0]!.value).toBe(SPLICE_NO_EFFECT);
    expect(opts[0]!.label).toBe('No effect');
  });

  it('orders the rest by gallery collection, then by name', () => {
    expect(spliceEffectOptions(effects).slice(1).map((o) => o.label)).toEqual(['Whole Drum', 'Comet Trails', 'Plasma']);
  });

  it('hides retired effects', () => {
    const withDead = [...effects, { ...effect('gen:burst', 'Burst', 'hits'), deprecated: { replacedBy: 'gen:plasma' } }];
    expect(spliceEffectOptions(withDead).some((o) => o.label === 'Burst')).toBe(false);
  });
});

describe('motion options', () => {
  it('offers all three motions in the order they escalate', () => {
    expect(SPLICE_CHASE_OPTS.map((o) => o.value)).toEqual(['off', 'step', 'smooth', 'stagger']);
  });

  it('explains every motion except Off, since the three moving ones are easy to confuse', () => {
    for (const opt of SPLICE_CHASE_OPTS) {
      if (opt.value === 'off') expect(SPLICE_CHASE_HINTS[opt.value]).toBe('');
      else expect(SPLICE_CHASE_HINTS[opt.value], opt.value).not.toBe('');
    }
  });
});

describe('motion mode options', () => {
  it('offers all three, and explains each — they are easy to confuse', () => {
    expect(SPLICE_MOTION_MODE_OPTS.map((o) => o.value)).toEqual(['restart', 'continuous', 'latched']);
    for (const opt of SPLICE_MOTION_MODE_OPTS) expect(SPLICE_MOTION_MODE_HINTS[opt.value], opt.value).not.toBe('');
  });
});

describe('divisions', () => {
  it('offers half notes and bar lengths alongside the existing values', () => {
    const values = DIVISION_OPTS.map((o) => o.value);
    for (const v of ['1/2', '1/4', '1/8', '1/16', '1-bar', '2-bars', '4-bars']) expect(values, v).toContain(v);
  });

  it('labels bar lengths readably', () => {
    const label = (v: string) => DIVISION_OPTS.find((o) => o.value === v)?.label;
    expect(label('1-bar')).toBe('1 bar');
    expect(label('2-bars')).toBe('2 bars');
    expect(label('4-bars')).toBe('4 bars');
    expect(label('dotted-1/2')).toBe('1/2 dotted');
  });
});

describe('wait mode options', () => {
  it('offers all three, and explains the difference', () => {
    expect(SPLICE_WAIT_MODE_OPTS.map((o) => o.value)).toEqual(['lit', 'dark', 'fade', 'pulse']);
    for (const opt of SPLICE_WAIT_MODE_OPTS) expect(SPLICE_WAIT_MODE_HINTS[opt.value], opt.value).not.toBe('');
  });
});

describe('describeSpliceRow', () => {
  const name = (id: string) => (id === 'fx' ? 'Comet Trails' : id);
  const row = (over: Partial<ReturnType<typeof spliceRows>[number]>) => ({
    index: 0,
    color: null,
    effectId: null,
    muted: false,
    blank: false,
    cycled: false,
    ...over,
  });

  it('names what is inside the splice', () => {
    expect(describeSpliceRow(row({ effectId: 'fx' }), name)).toBe('Comet Trails');
    expect(describeSpliceRow(row({ effectId: 'fx', color: '#f00' }), name)).toBe('Comet Trails · tinted');
    expect(describeSpliceRow(row({ color: '#f00' }), name)).toBe('colour');
    expect(describeSpliceRow(row({ blank: true }), name)).toBe('blank');
  });

  it('says muted before anything else — it is why the splice is dark', () => {
    expect(describeSpliceRow(row({ effectId: 'fx', color: '#f00', muted: true }), name)).toBe('muted');
  });
});
