import { describe, expect, it } from 'vitest';
import { effectChain } from '@ledrums/core';
import { MASTER_CELL } from './effects-api';
import * as doc from './effects-doc';
import type { EffectsSection } from './effects-doc';

type EffectCell = effectChain.EffectCell;

const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const kickEdge: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 1 } };
const snareHead: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 0 } };
const kitAlways: EffectCell = { row: 'kit', column: { kind: 'always' } };
const kitZone: EffectCell = { row: 'kit', column: { kind: 'zone', slot: 0 } };

function fx(id: string, cell: EffectCell, extra: Record<string, unknown> = {}): effectChain.Effect {
  return effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'solid' }, ...extra });
}

function section(...effects: effectChain.Effect[]): EffectsSection & { id: string } {
  return { id: 'sec', effects, master: [] };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const ids = (s: EffectsSection): string[] => s.effects.map((e) => e.id);

describe('effects-doc: Effects', () => {
  it('addEffect appends a schema-complete Effect on top of the cell, named after the Style', () => {
    const start = deepFreeze(section(fx('a', kickHead)));
    const { section: next, id } = doc.addEffect(start, snareHead, 'wave', 'radial');
    expect(id).toMatch(/^fx-\d+$/);
    expect(ids(next)).toEqual(['a', id]);
    const added = doc.effectById(next, id!)!;
    expect(added).toMatchObject({
      name: 'Radial',
      cell: snareHead,
      trigger: { kind: 'zone' },
      target: { kind: 'select', drums: [{ drumId: 'snare' }] },
      generator: { kind: 'wave', style: 'radial', params: {} },
      blend: 'add',
      opacity: 1,
    });
    expect((next as { id: string }).id).toBe('sec'); // extra section fields pass through
  });

  it('addEffect on the Kit row targets the kit; a zone on the Kit row is refused', () => {
    const start = section();
    const kit = doc.addEffect(start, kitAlways, 'gradient');
    expect(doc.effectById(kit.section, kit.id!)).toMatchObject({ name: 'Gradient', target: { kind: 'kit' }, trigger: { kind: 'always' } });
    const refused = doc.addEffect(start, kitZone, 'solid');
    expect(refused).toEqual({ section: start, id: null });
  });

  it('addEffect refuses a Style the Generator does not have', () => {
    const start = deepFreeze(section());
    expect(doc.addEffect(start, kickHead, 'wave', 'bogus')).toEqual({ section: start, id: null });
    expect(doc.addEffect(start, kickHead, 'wave', 'bogus').section).toBe(start);
  });

  it('addEffect mints ids that never collide with the section', () => {
    let s: EffectsSection = section();
    const minted = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const out = doc.addEffect(s, kickHead, 'solid');
      minted.add(out.id!);
      s = out.section;
    }
    expect(minted.size).toBe(5);
  });

  it('removeEffect drops only that Effect; an unknown id returns the same section', () => {
    const start = deepFreeze(section(fx('a', kickHead), fx('b', kickHead)));
    expect(ids(doc.removeEffect(start, 'a'))).toEqual(['b']);
    expect(doc.removeEffect(start, 'zzz')).toBe(start);
  });

  it('duplicateEffect inserts a deep copy directly above the source', () => {
    const start = deepFreeze(section(fx('a', kickHead, { modifiers: [{ uid: 'm1', modifierId: 'strobe' }] }), fx('b', snareHead)));
    const { section: next, id } = doc.duplicateEffect(start, 'a');
    expect(ids(next)).toEqual(['a', id, 'b']);
    const copy = doc.effectById(next, id!)!;
    expect(copy.name).toBe('a copy');
    expect(copy.modifiers).toEqual(start.effects[0]!.modifiers);
    expect(copy.modifiers).not.toBe(start.effects[0]!.modifiers);
  });

  it('moveEffect reorders within a cell stack and leaves other cells in place', () => {
    const start = deepFreeze(section(fx('a', kickHead), fx('x', snareHead), fx('b', kickHead), fx('c', kickHead)));
    const next = doc.moveEffect(start, 'c', kickHead, 0);
    expect(doc.cellEffects(next, kickHead).map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(ids(next).filter((id) => id === 'x')).toEqual(['x']);
    expect(doc.moveEffect(start, 'a', kickHead, 0)).toBe(start); // already there
  });

  it('moveEffect into another column re-derives the trigger; across rows a default Target follows', () => {
    const start = section(fx('a', kickHead), fx('b', snareHead));
    const next = doc.moveEffect(start, 'a', kitAlways, 0);
    expect(doc.effectById(next, 'a')).toMatchObject({ cell: kitAlways, trigger: { kind: 'always' }, target: { kind: 'kit' } });
    // an empty destination keeps the composition position
    expect(ids(next)).toEqual(['a', 'b']);
  });

  it('moveEffect keeps a custom Target and appends past the destination stack for a large index', () => {
    const custom = { kind: 'select', drums: [{ drumId: 'snare', hoops: [1] }] };
    const start = section(fx('a', kickHead, { target: custom }), fx('b', snareHead), fx('c', snareHead));
    const next = doc.moveEffect(start, 'a', snareHead, 99);
    expect(doc.cellEffects(next, snareHead).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(doc.effectById(next, 'a')!.target).toEqual(custom);
  });

  it('moveEffect onto a Kit-row zone is refused', () => {
    const start = section(fx('a', kickHead));
    expect(doc.moveEffect(start, 'a', kitZone, 0)).toBe(start);
  });

  it('header settings edit one field and are no-ops when unchanged', () => {
    const start = deepFreeze(section(fx('a', kickHead)));
    expect(doc.effectById(doc.renameEffect(start, 'a', '  Kick hit '), 'a')!.name).toBe('Kick hit');
    expect(doc.renameEffect(start, 'a', 'a')).toBe(start);
    expect(doc.effectById(doc.setEffectBypass(start, 'a', true), 'a')!.bypass).toBe(true);
    expect(doc.setEffectBypass(start, 'a', false)).toBe(start);
    expect(doc.effectById(doc.setEffectBlend(start, 'a', 'screen'), 'a')!.blend).toBe('screen');
    expect(doc.effectById(doc.setRetrigger(start, 'a', 'restart'), 'a')!.retrigger).toBe('restart');
  });

  it('setEffectOpacity clamps to 0..1 and ignores non-finite values', () => {
    const start = section(fx('a', kickHead));
    expect(doc.effectById(doc.setEffectOpacity(start, 'a', 1.7), 'a')!.opacity).toBe(1);
    expect(doc.effectById(doc.setEffectOpacity(start, 'a', -2), 'a')!.opacity).toBe(0);
    expect(doc.setEffectOpacity(start, 'a', Number.NaN)).toBe(start);
  });

  it('setAmp merges into the envelope and refuses an invalid value', () => {
    const start = section(fx('a', kickHead));
    const next = doc.setAmp(start, 'a', { attackMs: 50, length: 'hold' });
    expect(doc.effectById(next, 'a')!.amp).toMatchObject({ attackMs: 50, length: 'hold', releaseMs: 300 });
    expect(doc.setAmp(start, 'a', { attackMs: -1 })).toBe(start);
  });

  it('setTrigger edits settings in place for the same kind', () => {
    const start = section(fx('a', { row: 'kit', column: { kind: 'clock' } }));
    const next = doc.setTrigger(start, 'a', { kind: 'clock', every: { bars: 1 }, offsetBeats: 0.5 });
    expect(doc.effectById(next, 'a')).toMatchObject({ cell: { column: { kind: 'clock' } }, trigger: { every: { bars: 1 }, offsetBeats: 0.5 } });
  });

  it('setTrigger to a different kind moves the Effect to that column of its row', () => {
    const start = section(fx('a', kickHead), fx('b', snareHead));
    const cue = doc.setTrigger(start, 'a', { kind: 'cue', source: { midiNote: 40 } });
    expect(doc.effectById(cue, 'a')).toMatchObject({ cell: { row: 'kick', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 40 } } });
    expect(ids(cue)).toEqual(['a', 'b']);
    const back = doc.setTrigger(cue, 'a', { kind: 'zone' }, 1);
    expect(doc.effectById(back, 'a')!.cell).toEqual(kickEdge);
    expect(doc.setTrigger(cue, 'a', { kind: 'zone' })).toBe(cue); // no slot to land in
  });

  it('setTarget replaces the Target', () => {
    const start = section(fx('a', kickHead));
    expect(doc.effectById(doc.setTarget(start, 'a', { kind: 'hitDrum' }), 'a')!.target).toEqual({ kind: 'hitDrum' });
    expect(doc.setTarget(start, 'a', { kind: 'select', drums: [{ drumId: 'kick' }] })).toBe(start);
  });
});

describe('effects-doc: Generator', () => {
  const rich = (): EffectsSection =>
    section(
      fx('a', kickHead, {
        generator: { kind: 'solid', params: { hue: 0.3 } },
        modifiers: [{ uid: 'm1', modifierId: 'strobe' }],
        controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'generator', param: 'hue' }] }],
        target: { kind: 'hitDrum' },
      }),
    );

  it('setGenerator swaps kind / Style and keeps modifiers, controls and target', () => {
    const start = deepFreeze(rich());
    const next = doc.effectById(doc.setGenerator(start, 'a', 'wave', 'radial'), 'a')!;
    const before = start.effects[0]!;
    expect(next.generator).toEqual({ kind: 'wave', style: 'radial', params: {} });
    expect(next.modifiers).toEqual(before.modifiers);
    expect(next.controls).toEqual(before.controls);
    expect(next.target).toEqual({ kind: 'hitDrum' });
    expect(doc.setGenerator(start, 'a', 'solid', '')).toBe(start);
  });

  it('setGenerator refuses a Style the Generator does not have', () => {
    const start = deepFreeze(rich());
    expect(doc.setGenerator(start, 'a', 'wave', 'bogus')).toBe(start);
  });

  it('setGenerator keeps slots only across Splice / Slice', () => {
    const start = section(fx('a', kickHead, { generator: { kind: 'splice', slots: [{ color: '#ff0000' }] } }));
    const slice = doc.effectById(doc.setGenerator(start, 'a', 'slice'), 'a')!;
    expect(slice.generator.slots).toEqual([{ color: '#ff0000' }]);
    const solid = doc.effectById(doc.setGenerator(start, 'a', 'solid'), 'a')!;
    expect(solid.generator.slots).toBeUndefined();
  });

  it('setGeneratorParam sets one param; setSpliceSlots only applies to Splice / Slice', () => {
    const start = rich();
    expect(doc.effectById(doc.setGeneratorParam(start, 'a', 'hue', 0.8), 'a')!.generator.params).toEqual({ hue: 0.8 });
    expect(doc.setGeneratorParam(start, 'a', 'hue', 0.3)).toBe(start);
    expect(doc.setSpliceSlots(start, 'a', [{ color: '#fff' }])).toBe(start);
    const splice = section(fx('s', kickHead, { generator: { kind: 'splice' } }));
    const slots = [{ color: '#00ff00' }, { generator: { kind: 'solid' as const, style: '', params: {} } }];
    expect(doc.effectById(doc.setSpliceSlots(splice, 's', slots), 's')!.generator.slots).toEqual(slots);
  });
});

describe('effects-doc: a Slice cuts the whole kit by default (the graph Slice node’s On: Kit)', () => {
  const empty: EffectsSection = { effects: [], master: [] };

  it('a new Slice targets the kit; a new Wave keeps its drum', () => {
    const slice = doc.addEffect(empty, kickHead, 'slice');
    expect(slice.section.effects[0]!.target).toEqual({ kind: 'kit' });
    const wave = doc.addEffect(empty, kickHead, 'wave');
    expect(wave.section.effects[0]!.target).toEqual({ kind: 'select', drums: [{ drumId: 'kick' }] });
  });

  it('switching to Slice widens the row’s default Target to the kit, but keeps a Target someone chose', () => {
    const base: EffectsSection = { effects: [fx('a', kickHead), fx('b', kickHead, { target: { kind: 'hitDrum' } })], master: [] };
    let s = doc.setGenerator(base, 'a', 'slice');
    s = doc.setGenerator(s, 'b', 'slice');
    expect(s.effects.map((e) => e.target)).toEqual([{ kind: 'kit' }, { kind: 'hitDrum' }]);
  });

  it('setGeneratorParams writes several params at once, and undefined removes one', () => {
    const base: EffectsSection = { effects: [fx('a', kickHead, { generator: { kind: 'slice', params: { regionCx: 1, count: 3 } } })], master: [] };
    const s = doc.setGeneratorParams(base, 'a', { regionCx: undefined, axis: 'y' });
    expect(s.effects[0]!.generator.params).toEqual({ count: 3, axis: 'y' });
    expect(doc.setGeneratorParams(s, 'a', { regionCx: undefined })).toBe(s); // nothing to change
  });
});

describe('effects-doc: Modifiers', () => {
  for (const owner of ['a', MASTER_CELL] as const) {
    const chain = (s: EffectsSection) => (owner === MASTER_CELL ? s.master : doc.effectById(s, 'a')!.modifiers);

    it(`add / move / edit / remove on ${owner === MASTER_CELL ? 'the master chain' : 'an Effect chain'}`, () => {
      let s: EffectsSection = deepFreeze(section(fx('a', kickHead)));
      const first = doc.addModifier(s, owner, 'strobe');
      expect(first.id).toMatch(/^mod-\d+$/);
      s = first.section;
      const second = doc.addModifier(s, owner, 'strobe', 0);
      s = second.section;
      expect(chain(s).map((m) => m.uid)).toEqual([second.id, first.id]);
      expect(chain(s)[0]).toMatchObject({ modifierId: 'strobe', params: {}, mix: 1, bypass: false });

      s = doc.moveModifier(s, owner, second.id!, 5);
      expect(chain(s).map((m) => m.uid)).toEqual([first.id, second.id]);
      s = doc.setModifierParam(s, owner, first.id!, 'rate', 4);
      s = doc.setModifierMix(s, owner, first.id!, 3);
      s = doc.setModifierBypass(s, owner, first.id!, true);
      s = doc.setModifierEnvelope(s, owner, first.id!, { attackMs: 5, decayMs: 0, sustainLevel: 1, releaseMs: 20 });
      expect(chain(s)[0]).toMatchObject({ params: { rate: 4 }, mix: 1, bypass: true, envelope: { attackMs: 5, releaseMs: 20 } });
      s = doc.setModifierEnvelope(s, owner, first.id!, null);
      expect(chain(s)[0]!.envelope).toBeUndefined();
      expect(doc.setModifierEnvelope(s, owner, first.id!, null)).toBe(s);

      s = doc.removeModifier(s, owner, first.id!);
      expect(chain(s).map((m) => m.uid)).toEqual([second.id]);
    });
  }

  it('addModifier refuses an unknown modifier id or Effect', () => {
    const start = section(fx('a', kickHead));
    expect(doc.addModifier(start, 'a', 'no-such-modifier')).toEqual({ section: start, id: null });
    expect(doc.addModifier(start, 'zzz', 'strobe')).toEqual({ section: start, id: null });
  });

  it('removeModifier removes control mappings that drove it', () => {
    const start = section(
      fx('a', kickHead, {
        modifiers: [{ uid: 'm1', modifierId: 'strobe' }],
        controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'm1', param: 'rate' }, { device: 'generator', param: 'hue' }] }],
      }),
    );
    const next = doc.effectById(doc.removeModifier(start, 'a', 'm1'), 'a')!;
    expect(next.modifiers).toEqual([]);
    expect(next.controls[0]!.mappings.map((m) => m.device)).toEqual(['generator']);
  });

  it('setModifierMix clamps to 0..1', () => {
    const start = section(fx('a', kickHead, { modifiers: [{ uid: 'm1', modifierId: 'strobe' }] }));
    expect(doc.effectById(doc.setModifierMix(start, 'a', 'm1', -0.5), 'a')!.modifiers[0]!.mix).toBe(0);
  });
});

describe('effects-doc: Controls', () => {
  it('add a control, edit settings, and add / edit / remove mappings', () => {
    let s: EffectsSection = deepFreeze(section(fx('a', kickHead)));
    const added = doc.addControl(s, 'a', 'lfo');
    expect(added.id).toMatch(/^ctl-\d+$/);
    s = added.section;
    const uid = added.id!;
    expect(doc.effectById(s, 'a')!.controls[0]).toMatchObject({ kind: 'lfo', settings: { waveform: 'sine', rateHz: 1 }, mappings: [] });

    s = doc.setControlSettings(s, 'a', uid, { rateHz: 4 });
    expect(doc.effectById(s, 'a')!.controls[0]!.settings).toMatchObject({ rateHz: 4, waveform: 'sine' });
    expect(doc.setControlSettings(s, 'a', uid, { rateHz: -1 })).toBe(s); // schema refuses

    s = doc.addMapping(s, 'a', uid, { device: 'generator', param: 'hue', amount: 0.5, invert: false });
    s = doc.setMapping(s, 'a', uid, 0, { amount: 0.25, rangeMax: 0.9 });
    expect(doc.effectById(s, 'a')!.controls[0]!.mappings).toEqual([
      { device: 'generator', param: 'hue', amount: 0.25, invert: false, rangeMax: 0.9 },
    ]);
    expect(doc.setMapping(s, 'a', uid, 3, { amount: 1 })).toBe(s);
    s = doc.removeMapping(s, 'a', uid, 0);
    expect(doc.effectById(s, 'a')!.controls[0]!.mappings).toEqual([]);

    s = doc.removeControl(s, 'a', uid);
    expect(doc.effectById(s, 'a')!.controls).toEqual([]);
  });
});

describe('effects-doc: cells', () => {
  it('copyCell deep-copies the stack; pasteCell re-homes it with fresh ids on top of the target cell', () => {
    const start = deepFreeze(section(fx('a', kickHead), fx('b', kickHead), fx('x', snareHead)));
    const clip = doc.copyCell(start, kickHead);
    expect(clip.map((e) => e.id)).toEqual(['a', 'b']);
    const { section: next, result } = doc.pasteCell(start, snareHead, clip);
    expect(result).toEqual({ ok: true });
    const stack = doc.cellEffects(next, snareHead);
    expect(stack.map((e) => e.name)).toEqual(['x', 'a', 'b']);
    expect(new Set(next.effects.map((e) => e.id)).size).toBe(5);
    expect(stack[1]!.target).toEqual({ kind: 'select', drums: [{ drumId: 'snare' }] });
  });

  it('pasteCell refuses an empty clipboard and a cell the stack cannot live in', () => {
    const start = section(fx('a', kickHead));
    expect(doc.pasteCell(start, snareHead, []).result).toEqual({ ok: false, reason: 'Nothing to paste.' });
    const refused = doc.pasteCell(start, kitZone, doc.copyCell(start, kickHead));
    expect(refused.result.ok).toBe(false);
    expect(refused.section).toBe(start);
  });

  it('clearCell removes only that cell', () => {
    const start = section(fx('a', kickHead), fx('x', snareHead));
    expect(ids(doc.clearCell(start, kickHead))).toEqual(['x']);
    expect(doc.clearCell(start, kickEdge)).toBe(start);
  });
});
