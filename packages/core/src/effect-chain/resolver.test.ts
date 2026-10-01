import { describe, expect, it } from 'vitest';
import { resolveGenerator } from './generators';
import { alwaysEffects, clockEffectsCrossed, effectPlayAction, matchSectionEffects } from './resolver';
import { CHAIN_BUS_ID, chainEffectDef, chainEffectDefId } from './runtime';
import { parseEffect, type Effect, type GeneratorDevice } from './types';

const zone = (id: string, row: string, slot: number, over: Record<string, unknown> = {}): Effect =>
  parseEffect({ id, cell: { row, column: { kind: 'zone', slot } }, generator: { kind: 'solid' }, ...over });

const ctx = { velocity: 1, sourceDrumId: 'kick', bpm: 120, layerOrder: 3 };

describe('Effect schema', () => {
  it('parses a minimal Effect with every default applied', () => {
    const e = parseEffect({ id: 'e', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } });
    expect(e).toEqual({
      id: 'e', name: '', bypass: false,
      cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
      trigger: { kind: 'zone' },
      retrigger: 'overlap',
      amp: { attackMs: 10, decayMs: 0, sustainLevel: 1, length: { ms: 500 }, releaseMs: 300 },
      generator: { kind: 'solid', style: '', params: {} },
      modifiers: [], controls: [],
      target: { kind: 'select', drums: [{ drumId: 'kick' }] },
      blend: 'add', opacity: 1,
    });
  });

  it('derives a clock trigger with its defaults from the cell, and a kit target from the Kit row', () => {
    const e = parseEffect({ id: 'c', cell: { row: 'kit', column: { kind: 'clock' } }, generator: { kind: 'wave' } });
    expect(e.trigger).toEqual({ kind: 'clock', every: { beats: 1 }, offsetBeats: 0 });
    expect(e.target).toEqual({ kind: 'kit' });
  });

  it('defaults modifier mix to 1 and bypass to false', () => {
    const e = zone('m', 'kick', 0, { modifiers: [{ uid: 'm1', modifierId: 'trail' }] });
    expect(e.modifiers).toEqual([{ uid: 'm1', modifierId: 'trail', params: {}, mix: 1, bypass: false }]);
  });

  it('rejects a trigger kind that disagrees with the cell column', () => {
    expect(() => parseEffect({
      id: 'x', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, trigger: { kind: 'always' }, generator: { kind: 'solid' },
    })).toThrow(/does not match cell column/);
  });

  it('rejects a zone column on the Kit row', () => {
    expect(() => parseEffect({ id: 'x', cell: { row: 'kit', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } }))
      .toThrow(/Kit row has no zone/);
  });
});

describe('matching', () => {
  const cue = parseEffect({
    id: 'cue', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 36, oscAddress: '/x' } },
    generator: { kind: 'solid' },
  });
  const section = { effects: [zone('a', 'kick', 0), zone('b', 'kick', 1), cue, zone('c', 'kick', 0, { bypass: true }), zone('d', 'kick', 0)] };

  it('matches zone Effects by (row drum, slot), in section order, bypassed excluded', () => {
    expect(matchSectionEffects(section, { drumId: 'kick', slot: 0 }).map((e) => e.id)).toEqual(['a', 'd']);
    expect(matchSectionEffects(section, { drumId: 'snare', slot: 0 })).toEqual([]);
  });

  it('matches Cue Effects by note or address alongside zone Effects on the same input', () => {
    expect(matchSectionEffects(section, { drumId: 'kick', slot: 0, midiNote: 36 }).map((e) => e.id)).toEqual(['a', 'cue', 'd']);
    expect(matchSectionEffects(section, { oscAddress: '/x' }).map((e) => e.id)).toEqual(['cue']);
  });

  it('lists Always Effects', () => {
    const always = parseEffect({ id: 'al', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'solid' } });
    expect(alwaysEffects({ effects: [zone('a', 'kick', 0), always] }).map((e) => e.id)).toEqual(['al']);
  });

  it('clock crossings fire on (prev, beat], honour offset and bars, and ignore a backwards transport', () => {
    const clock = (every: object, offsetBeats = 0): Effect => parseEffect({
      id: 'k', cell: { row: 'kit', column: { kind: 'clock' } }, trigger: { kind: 'clock', every, offsetBeats }, generator: { kind: 'solid' },
    });
    const s = (e: Effect) => ({ effects: [e] });
    expect(clockEffectsCrossed(s(clock({ beats: 1 })), 0.75, 1)).toHaveLength(1);
    expect(clockEffectsCrossed(s(clock({ beats: 1 })), 1, 1.25)).toHaveLength(0);
    expect(clockEffectsCrossed(s(clock({ beats: 1 }, 0.5)), 1, 1.5)).toHaveLength(1);
    expect(clockEffectsCrossed(s(clock({ bars: 1 })), 3.9, 4, 4)).toHaveLength(1);
    expect(clockEffectsCrossed(s(clock({ bars: 1 })), 3.9, 4, 3)).toHaveLength(0);
    expect(clockEffectsCrossed(s(clock({ beats: 1 })), 0, 10)).toHaveLength(1); // no burst
    expect(clockEffectsCrossed(s(clock({ beats: 1 })), 5, 2)).toHaveLength(0);
  });
});

describe('generator resolution', () => {
  it('resolves the tracer styles and defaults an empty style to the first', () => {
    expect(resolveGenerator({ kind: 'solid', style: '', params: {} })?.effectId).toBe('solid-colour');
    expect(resolveGenerator({ kind: 'solid', style: 'simple', params: {} })?.effectId).toBe('whole-drum');
    expect(resolveGenerator({ kind: 'wave', style: 'radial', params: {} })?.effectId).toBe('radial-wash');
    expect(resolveGenerator({ kind: 'wave', style: 'chase', params: {} })?.effectId).toBe('chase-bands');
  });

  it('returns null for an unknown kind or style', () => {
    expect(resolveGenerator({ kind: 'no-such-kind' as GeneratorDevice['kind'], style: '', params: {} })).toBeNull();
    expect(resolveGenerator({ kind: 'wave', style: 'nope', params: {} })).toBeNull();
  });

  it('builds an internal chain EffectDef from the generator param spec on the internal bus', () => {
    const def = chainEffectDef('solid-colour')!;
    expect(def.id).toBe(chainEffectDefId('solid-colour'));
    expect(def.busId).toBe(CHAIN_BUS_ID);
    expect(def.params.map((p) => p.key)).toEqual(['color', 'brightness']);
    expect(chainEffectDef('no-such-generator')).toBeNull();
  });
});

describe('effectPlayAction', () => {
  it('carries generator params over spec defaults, blend/opacity/layer order and the chain id', () => {
    const e = zone('p', 'kick', 0, { generator: { kind: 'solid', params: { color: '#ff0000' } }, blend: 'screen', opacity: 0.4 });
    const a = effectPlayAction(e, ctx)!;
    expect(a).toMatchObject({
      kind: 'play', effectId: chainEffectDefId('solid-colour'), busId: CHAIN_BUS_ID, mode: 'oneshot',
      params: { color: '#ff0000', brightness: 1 }, chainEffectId: 'p', blend: 'screen', opacity: 0.4, layerOrder: 3,
      scope: 'kit', targets: ['kick'],
    });
  });

  it('maps the amp envelope: gate length to sustain after the attack, beats at the fire bpm, hold / loop modes', () => {
    const at = (amp: object, trigger?: object) => effectPlayAction(zone('a', 'kick', 0, { amp }), ctx)!;
    expect(at({ attackMs: 100, length: { ms: 400 }, releaseMs: 50 })).toMatchObject({ attackMs: 100, sustainMs: 300, releaseMs: 50, mode: 'oneshot' });
    expect(at({ attackMs: 0, length: { beats: 2 } })).toMatchObject({ sustainMs: 1000 });
    expect(at({ length: 'hold' }).mode).toBe('hold');
    expect(at({ length: 'loop' }).mode).toBe('loop');
    // sustain level 1 → a flat curve at 1, so the amp envelope still owns the level
    expect(at({})).toMatchObject({ lifeEnvelope: { h0: { x: 0, y: 1 }, h1: { x: 1, y: 1 } } });
    expect(at({ attackMs: 100, decayMs: 100, sustainLevel: 0.5 })).toMatchObject({
      lifeSpanMs: 200, lifeEnvelope: { h0: { x: 0.5, y: 1 }, h1: { x: 1, y: 0.5 } },
    });
  });

  it('an Always Effect always plays in loop mode', () => {
    const e = parseEffect({ id: 'al', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'solid' } });
    expect(effectPlayAction(e, ctx)!.mode).toBe('loop');
  });

  it('turns modifiers into a resolved chain with mix, envelope and bypass', () => {
    const e = zone('m', 'kick', 0, {
      modifiers: [
        { uid: 'm1', modifierId: 'trail', mix: 0.5, envelope: { attackMs: 20 } },
        { uid: 'm2', modifierId: 'strobe', bypass: true },
      ],
    });
    expect(effectPlayAction(e, ctx)!.modifiers).toEqual([
      { modifierId: 'trail', params: {}, mix: 0.5, envelope: { attackMs: 20, decayMs: 0, sustainLevel: 1, releaseMs: 0 } },
      { modifierId: 'strobe', params: {}, mix: 1, bypass: true },
    ]);
  });

  it('turns control mappings into generator and per-modifier modulations, ranges defaulting to the param spec', () => {
    const e = zone('c', 'kick', 0, {
      generator: { kind: 'wave', style: 'radial' },
      modifiers: [{ uid: 'm1', modifierId: 'trail' }],
      controls: [
        { uid: 'l', kind: 'lfo', mappings: [{ device: 'generator', param: 'hue' }, { device: 'm1', param: 'decayMs', amount: 0.5 }] },
        { uid: 'v', kind: 'velocity', mappings: [{ device: 'generator', param: 'brightness', rangeMin: 0.2, rangeMax: 0.8, invert: true }] },
        { uid: 'x', kind: 'cc', mappings: [{ device: 'missing-uid', param: 'hue' }, { device: 'generator', param: 'mode' }] },
      ],
    });
    const a = effectPlayAction(e, ctx)!;
    expect(a.modulations).toEqual([
      expect.objectContaining({ targetParam: 'hue', source: expect.objectContaining({ kind: 'lfo' }), rangeMin: 0, rangeMax: 360, amount: 1, invert: false }),
      { targetParam: 'brightness', source: { kind: 'velocity' }, amount: 1, invert: true, rangeMin: 0.2, rangeMax: 0.8 },
    ]);
    const trail = a.modifiers![0]!;
    expect(trail.modulations).toEqual([expect.objectContaining({ targetParam: 'decayMs', amount: 0.5, rangeMin: 0, rangeMax: 4000 })]);
  });

  it('maps targets: kit, hitDrum (struck drum, else the row drum), select with hoops', () => {
    const t = (target: object, sourceDrumId: string | null, row = 'kick') =>
      effectPlayAction(zone('t', row, 0, { target }), { ...ctx, sourceDrumId })!;
    expect(t({ kind: 'kit' }, 'kick')).toMatchObject({ scope: 'kit' });
    expect(t({ kind: 'hitDrum' }, 'snare')).toMatchObject({ scope: 'drum', targetId: 'snare' });
    expect(t({ kind: 'hitDrum' }, null, 'tom')).toMatchObject({ scope: 'drum', targetId: 'tom' });
    expect(t({ kind: 'select', drums: [{ drumId: 'kick', hoops: [1, 2] }, { drumId: 'tom' }] }, null).targets).toEqual(['kick#1,2', 'tom']);
  });

  it('returns null for an unresolvable generator', () => {
    expect(effectPlayAction(zone('u', 'kick', 0, { generator: { kind: 'pattern', style: 'nope' } }), ctx)).toBeNull();
  });
});

describe('the brightness envelope — one per Effect (Tim, 2026-10-01)', () => {
  const effect = (over: Record<string, unknown>): Effect => zone('e', 'kick', 0, over);

  it('an attack curve reaches the voice; linear (or none) leaves the ramp straight', () => {
    const eased = effectPlayAction(effect({ amp: { attackMs: 40, attackEase: { fn: 'quad', dir: 'in' } } }), ctx)!;
    expect(eased.attackEase).toEqual({ fn: 'quad', dir: 'in' });
    expect(effectPlayAction(effect({ amp: { attackMs: 40, attackEase: { fn: 'linear', dir: 'in' } } }), ctx)!.attackEase).toBeUndefined();
    expect(effectPlayAction(effect({}), ctx)!.attackEase).toBeUndefined();
  });

  it('a Splice’s parts run the Effect’s envelope — Attack, Sustain (the length after the attack), Decay — and its curve', () => {
    const splice = effect({
      generator: { kind: 'splice', slots: [{ color: '#ff0000' }], params: { waitMode: 'pulse' } },
      amp: { attackMs: 30, attackEase: { fn: 'cubic', dir: 'out' }, length: { ms: 500 }, releaseMs: 200 },
    });
    const action = effectPlayAction(splice, ctx)!;
    expect(action.splice!.envelope).toEqual({ attackMs: 30, sustainMs: 470, releaseMs: 200 });
    expect(action.splice!.attackEase).toEqual({ fn: 'cubic', dir: 'out' });
    expect([action.attackMs, action.sustainMs, action.releaseMs]).toEqual([30, 470, 200]); // the voice too
  });
});

describe('attack and decay in beats (Tim, 2026-10-02)', () => {
  const effect = (over: Record<string, unknown>): Effect => zone('e', 'kick', 0, over);
  it('a stage in beats resolves at the fire’s tempo and wins over its ms', () => {
    const a = effectPlayAction(effect({ amp: { attackMs: 10, attackBeats: 0.5, length: { beats: 2 }, releaseMs: 300, releaseBeats: 1 } }), { ...ctx, bpm: 120 })!;
    expect([a.attackMs, a.sustainMs, a.releaseMs]).toEqual([250, 750, 500]); // half a beat, 2 beats − attack, 1 beat
    const slow = effectPlayAction(effect({ amp: { attackBeats: 0.5, length: { beats: 2 }, releaseBeats: 1 } }), { ...ctx, bpm: 60 })!;
    expect([slow.attackMs, slow.releaseMs]).toEqual([500, 1000]);
  });
  it('without beats, the ms stand', () => {
    const a = effectPlayAction(effect({ amp: { attackMs: 40, length: { ms: 400 }, releaseMs: 120 } }), ctx)!;
    expect([a.attackMs, a.sustainMs, a.releaseMs]).toEqual([40, 360, 120]);
  });
});

describe('a modifier envelope in beats (Tim, 2026-10-02)', () => {
  it('resolves its beats stages at the fire’s tempo; ms stages stand', () => {
    const e = zone('m', 'kick', 0, { modifiers: [{ uid: 'm1', modifierId: 'strobe', envelope: { attackMs: 10, attackBeats: 0.5, decayMs: 20, releaseMs: 30, releaseBeats: 1 } }] });
    const env = effectPlayAction(e, { ...ctx, bpm: 120 })!.modifiers![0]!.envelope!;
    expect([env.attackMs, env.decayMs, env.releaseMs]).toEqual([250, 20, 500]);
  });
});
