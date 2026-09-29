import { describe, it, expect } from 'vitest';
import { effectChain, type CanvasScene } from '@ledrums/core';
import { buildGraphClipDoc, parse, serialize } from './clipdoc';
import { MASTER_CELL } from './effects-api';
import {
  CELL_FILE_EXT,
  DEVICE_FILE_EXT,
  EFFECT_FILE_EXT,
  applyCellFile,
  applyDeviceFile,
  applyEffectFile,
  applyFileToCell,
  applyFileToEffect,
  cellFile,
  deviceFile,
  effectFile,
  findDevice,
  type EffectsFileContext,
} from './effects-files';

type Effect = effectChain.Effect;

const scene = (id: string, hue = 140): CanvasScene => ({
  id,
  name: 'Scene ' + id,
  tags: ['canvas'],
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue, sat: 1, softness: 0.08 }],
});

const kickHead = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
const snareRim = { row: 'snare', column: { kind: 'zone' as const, slot: 1 } };
const kitAlways = { row: 'kit', column: { kind: 'always' as const } };
const kitClock = { row: 'kit', column: { kind: 'clock' as const } };

const skyEffect = (): Effect =>
  effectChain.parseEffect({
    id: 'fx-src',
    name: 'Sky',
    cell: kickHead,
    generator: { kind: 'scene', style: 'scene', params: { sceneId: 'sky' } },
    modifiers: [{ uid: 'm-src', modifierId: 'strobe', params: { rate: 4 }, mix: 0.5 }],
    controls: [{ uid: 'c-src', kind: 'lfo', mappings: [{ device: 'm-src', param: 'rate' }, { device: 'generator', param: 'speed' }] }],
    retrigger: 'restart',
    blend: 'screen',
    opacity: 0.6,
  });

const solid = (id: string, cell: effectChain.EffectCell = kickHead, extra: Record<string, unknown> = {}): Effect =>
  effectChain.parseEffect({ id, cell, generator: { kind: 'solid' }, ...extra });

interface TestSection {
  id: string;
  name: string;
  effects: Effect[];
  master: effectChain.ModifierDevice[];
}
const section = (effects: Effect[] = [], master: effectChain.ModifierDevice[] = []): TestSection => ({ id: 's1', name: 'Verse', effects, master });

/** Deterministic minters: ids count up, skipping taken ones like the real `freshId`. */
function ctx(over: Partial<EffectsFileContext> = {}): EffectsFileContext {
  let fx = 0;
  let dev = 0;
  let sc = 0;
  return {
    canvasScenes: [],
    mintEffectId: (taken) => {
      let id = `fx-${++fx}`;
      while (taken(id)) id = `fx-${++fx}`;
      return id;
    },
    mintUid: (taken) => {
      let id = `u-${++dev}`;
      while (taken(id)) id = `u-${++dev}`;
      return id;
    },
    mintScene: () => `scene-${++sc}`,
    ...over,
  };
}

const sources = { canvasScenes: [scene('sky')] };

describe('effect files — save', () => {
  it('names files from the Effect / device and uses the kind extensions', () => {
    const effect = skyEffect();
    expect(effectFile(effect, sources).fileName).toBe('Sky' + EFFECT_FILE_EXT);
    expect(cellFile(kickHead, [effect, solid('b')], sources).fileName).toBe('kick zone 0' + CELL_FILE_EXT);
    expect(deviceFile({ device: 'modifier', modifier: effect.modifiers[0]! }, sources).fileName).toBe('strobe' + DEVICE_FILE_EXT);
    expect(effectFile(effectChain.parseEffect({ id: 'x', name: 'a/b:c', cell: kitAlways, generator: { kind: 'wave' } }), {}).fileName).toBe('a-b-c' + EFFECT_FILE_EXT);
  });

  it('findDevice finds the Generator, a modifier, a control and a master modifier by uid', () => {
    const effect = skyEffect();
    const master = [{ uid: 'mm', modifierId: 'dim', params: {}, mix: 1, bypass: false }];
    const s = section([effect], master);
    expect(findDevice(s, 'fx-src', 'generator')).toEqual({ device: 'generator', generator: effect.generator });
    expect(findDevice(s, 'fx-src', 'm-src')).toEqual({ device: 'modifier', modifier: effect.modifiers[0] });
    expect(findDevice(s, 'fx-src', 'c-src')).toEqual({ device: 'control', control: effect.controls[0] });
    expect(findDevice(s, MASTER_CELL, 'mm')).toEqual({ device: 'modifier', modifier: master[0] });
    expect(findDevice(s, 'fx-src', 'nope')).toBeNull();
    expect(findDevice(s, 'gone', 'generator')).toBeNull();
  });
});

describe('applyEffectFile — load an Effect into a cell', () => {
  it('lands on top of the destination stack with fresh ids, remapped mappings and every setting kept', () => {
    const text = effectFile(skyEffect(), sources).text;
    const existing = solid('fx-1', snareRim);
    const before = section([existing]);
    const out = applyEffectFile(before, snareRim, text, ctx({ canvasScenes: [scene('sky')] }));
    expect(out.result).toEqual({ ok: true });
    expect(out.effectIds).toEqual(['fx-2']);
    const placed = out.section.effects[1]!;
    expect(out.section.effects.map((e) => e.id)).toEqual(['fx-1', 'fx-2']);
    expect(placed.cell).toEqual(snareRim);
    expect(placed.modifiers[0]!.uid).toBe('u-1');
    expect(placed.controls[0]!.uid).toBe('u-2');
    expect(placed.controls[0]!.mappings.map((m) => m.device)).toEqual(['u-1', 'generator']);
    expect({ name: placed.name, retrigger: placed.retrigger, blend: placed.blend, opacity: placed.opacity, mix: placed.modifiers[0]!.mix })
      .toEqual({ name: 'Sky', retrigger: 'restart', blend: 'screen', opacity: 0.6, mix: 0.5 });
    // the default drum target follows the row it lands in
    expect(placed.target).toEqual({ kind: 'select', drums: [{ drumId: 'snare' }] });
    // the scene already exists locally by content: reused, nothing new to add
    expect(out.canvasScenes).toEqual([]);
    expect(placed.generator.params.sceneId).toBe('sky');
    // other section fields ride through; the input is untouched
    expect(out.section.name).toBe('Verse');
    expect(before.effects).toEqual([existing]);
  });

  it('brings a scene the show lacks under a fresh id, pointing the Effect at it', () => {
    const out = applyEffectFile(section(), kickHead, effectFile(skyEffect(), sources).text, ctx({ canvasScenes: [scene('sky', 10)] }));
    expect(out.canvasScenes).toEqual([{ ...scene('sky'), id: 'scene-1' }]);
    expect(out.section.effects[0]!.generator.params.sceneId).toBe('scene-1');
  });

  it('moving to another column kind takes that column’s default trigger; same kind keeps settings', () => {
    const clocked = effectChain.parseEffect({ id: 'c', cell: kitClock, generator: { kind: 'solid' }, trigger: { kind: 'clock', every: { bars: 2 }, offsetBeats: 1 } });
    const text = effectFile(clocked, {}).text;
    const toZone = applyEffectFile(section(), kickHead, text, ctx());
    expect(toZone.section.effects[0]!.trigger).toEqual({ kind: 'zone' });
    const toClock = applyEffectFile(section(), { row: 'snare', column: { kind: 'clock' } }, text, ctx());
    expect(toClock.section.effects[0]!.trigger).toEqual({ kind: 'clock', every: { bars: 2 }, offsetBeats: 1 });
  });

  it('an explicit Target selection is kept; a Kit default follows onto a drum row', () => {
    const explicit = solid('e', kickHead, { target: { kind: 'select', drums: [{ drumId: 'tom1', hoops: [2] }] } });
    const kept = applyEffectFile(section(), snareRim, effectFile(explicit, {}).text, ctx());
    expect(kept.section.effects[0]!.target).toEqual({ kind: 'select', drums: [{ drumId: 'tom1', hoops: [2] }] });
    const kitWide = solid('k', kitAlways);
    const followed = applyEffectFile(section(), snareRim, effectFile(kitWide, {}).text, ctx());
    expect(followed.section.effects[0]!.target).toEqual({ kind: 'select', drums: [{ drumId: 'snare' }] });
  });

  it('fresh ids avoid every id and uid already in the section', () => {
    const s = section([solid('fx-1'), solid('fx-2', kickHead, { modifiers: [{ uid: 'u-1', modifierId: 'dim' }] })], [{ uid: 'u-2', modifierId: 'dim', params: {}, mix: 1, bypass: false }]);
    const out = applyEffectFile(s, kickHead, effectFile(skyEffect(), sources).text, ctx());
    const placed = out.section.effects[2]!;
    expect(placed.id).toBe('fx-3');
    expect([placed.modifiers[0]!.uid, placed.controls[0]!.uid]).toEqual(['u-3', 'u-4']);
  });

  it('refuses a zone cell on the Kit row, the wrong kind, a graph file and junk — section unchanged', () => {
    const s = section([solid('fx-1')]);
    const effectText = effectFile(skyEffect(), sources).text;
    const kitZone = applyEffectFile(s, { row: 'kit', column: { kind: 'zone', slot: 0 } }, effectText, ctx());
    expect(kitZone.result).toEqual({ ok: false, reason: 'The Kit row has no zone cells.' });
    expect(kitZone.section).toBe(s);

    const cellText = cellFile(kickHead, [solid('a')], {}).text;
    const wrongKind = applyEffectFile(s, kickHead, cellText, ctx());
    expect(wrongKind.result).toEqual({ ok: false, reason: 'That file holds a cell, not an Effect.' });

    const graphText = serialize(buildGraphClipDoc('g', { graphs: { g: { nodes: [], edges: [] } }, graphNames: {}, effects: [], presets: [] }));
    const graph = applyEffectFile(s, kickHead, graphText, ctx());
    expect(graph.result.ok).toBe(false);
    expect(graph.section).toBe(s);

    const junk = applyEffectFile(s, kickHead, 'not json', ctx());
    expect(junk.result).toEqual({ ok: false, reason: 'That file couldn’t be read as a LEDrums Effect, cell or device.' });
    expect(junk.canvasScenes).toEqual([]);
  });
});

describe('applyCellFile / applyFileToCell — load a stack into a cell', () => {
  it('appends the whole stack in the file’s order, each Effect re-celled with fresh ids', () => {
    const stack = [solid('a', kickHead, { name: 'one' }), solid('b', kickHead, { name: 'two' })];
    const text = cellFile(kickHead, stack, {}).text;
    const out = applyCellFile(section([solid('fx-1', kitAlways)]), kitAlways, text, ctx());
    expect(out.result.ok).toBe(true);
    expect(out.effectIds).toEqual(['fx-2', 'fx-3']);
    expect(out.section.effects.slice(1).map((e) => [e.name, e.cell, e.trigger, e.target])).toEqual([
      ['one', kitAlways, { kind: 'always' }, { kind: 'kit' }],
      ['two', kitAlways, { kind: 'always' }, { kind: 'kit' }],
    ]);
  });

  it('a cell saved and loaded back round-trips its stack (modulo ids)', () => {
    const stack = [skyEffect(), solid('b', kickHead, { opacity: 0.3 })];
    const out = applyCellFile(section(), kickHead, cellFile(kickHead, stack, sources).text, ctx({ canvasScenes: [scene('sky')] }));
    const strip = (e: Effect) => ({ ...e, id: '', modifiers: e.modifiers.map((m) => ({ ...m, uid: '' })), controls: e.controls.map((c) => ({ ...c, uid: '', mappings: c.mappings.map((m) => ({ ...m, device: m.device === 'generator' ? 'generator' : '' })) })) });
    expect(out.section.effects.map(strip)).toEqual(stack.map(strip));
  });

  it('applyFileToCell takes an Effect or a cell file and refuses a device file', () => {
    const s = section();
    expect(applyFileToCell(s, kickHead, effectFile(solid('a'), {}).text, ctx()).section.effects).toHaveLength(1);
    expect(applyFileToCell(s, kickHead, cellFile(kickHead, [solid('a'), solid('b')], {}).text, ctx()).section.effects).toHaveLength(2);
    const device = applyFileToCell(s, kickHead, deviceFile({ device: 'generator', generator: solid('a').generator }, {}).text, ctx());
    expect(device.result).toEqual({ ok: false, reason: 'That file holds a device, not an Effect or a cell.' });
  });

  it('an empty cell file loads nothing', () => {
    const out = applyCellFile(section(), kickHead, cellFile(kickHead, [], {}).text, ctx());
    expect(out.result).toEqual({ ok: false, reason: 'That file holds an empty cell.' });
  });
});

describe('applyDeviceFile — load one device into an Effect', () => {
  const target = (): Effect => solid('fx-1', kickHead, {
    name: 'Target',
    modifiers: [{ uid: 'u-1', modifierId: 'dim' }],
    controls: [{ uid: 'u-2', kind: 'velocity', mappings: [{ device: 'u-1', param: 'amount' }] }],
    target: { kind: 'hitDrum' },
  });

  it('a Generator replaces the Generator and keeps modifiers, controls and Target', () => {
    const src = skyEffect();
    const out = applyDeviceFile(section([target()]), 'fx-1', deviceFile({ device: 'generator', generator: src.generator }, sources).text, ctx({ canvasScenes: [] }));
    const effect = out.section.effects[0]!;
    expect(effect.generator).toEqual({ ...src.generator, params: { sceneId: 'scene-1' } });
    expect(out.canvasScenes.map((s) => s.id)).toEqual(['scene-1']);
    expect({ modifiers: effect.modifiers, controls: effect.controls, target: effect.target, name: effect.name })
      .toEqual({ modifiers: target().modifiers, controls: target().controls, target: { kind: 'hitDrum' }, name: 'Target' });
  });

  it('a Modifier is appended with a fresh uid', () => {
    const modifier = skyEffect().modifiers[0]!;
    const out = applyDeviceFile(section([target()]), 'fx-1', deviceFile({ device: 'modifier', modifier }, {}).text, ctx());
    expect(out.section.effects[0]!.modifiers).toEqual([target().modifiers[0], { ...modifier, uid: 'u-3' }]);
  });

  it('a Control is appended with a fresh uid, keeping only its Generator mappings', () => {
    const control = skyEffect().controls[0]!;
    const out = applyDeviceFile(section([target()]), 'fx-1', deviceFile({ device: 'control', control }, {}).text, ctx());
    const loaded = out.section.effects[0]!.controls[1]!;
    expect(loaded.uid).toBe('u-3');
    expect(loaded.mappings).toEqual([control.mappings[1]]);
  });

  it('the Master chain takes a Modifier and refuses a Generator', () => {
    const modifier = skyEffect().modifiers[0]!;
    const s = section([target()]);
    const out = applyDeviceFile(s, MASTER_CELL, deviceFile({ device: 'modifier', modifier }, {}).text, ctx());
    expect(out.section.master).toEqual([{ ...modifier, uid: 'u-3' }]);
    expect(out.section.effects).toBe(s.effects);
    const gen = applyDeviceFile(s, MASTER_CELL, deviceFile({ device: 'generator', generator: target().generator }, {}).text, ctx());
    expect(gen.result).toEqual({ ok: false, reason: 'The Master chain only takes modifiers.' });
  });

  it('refuses a missing Effect and a non-device file', () => {
    const s = section([target()]);
    const gone = applyDeviceFile(s, 'nope', deviceFile({ device: 'generator', generator: target().generator }, {}).text, ctx());
    expect(gone.result).toEqual({ ok: false, reason: 'That Effect is gone.' });
    const effect = applyDeviceFile(s, 'fx-1', effectFile(target(), {}).text, ctx());
    expect(effect.result).toEqual({ ok: false, reason: 'That file holds an Effect, not a device.' });
  });
});

describe('applyFileToEffect — load onto an existing Effect', () => {
  it('an Effect file replaces its contents in place, keeping id, cell and stack position', () => {
    const s = section([solid('fx-1'), solid('fx-9', snareRim, { modifiers: [{ uid: 'keep', modifierId: 'dim' }] }), solid('fx-3')]);
    const out = applyFileToEffect(s, 'fx-9', effectFile(skyEffect(), sources).text, ctx({ canvasScenes: [scene('sky')] }));
    expect(out.result.ok).toBe(true);
    expect(out.effectIds).toEqual(['fx-9']);
    expect(out.section.effects.map((e) => e.id)).toEqual(['fx-1', 'fx-9', 'fx-3']);
    const replaced = out.section.effects[1]!;
    expect(replaced.cell).toEqual(snareRim);
    expect(replaced.name).toBe('Sky');
    expect(replaced.target).toEqual({ kind: 'select', drums: [{ drumId: 'snare' }] });
  });

  it('a device file goes to applyDeviceFile; a cell file is refused', () => {
    const s = section([solid('fx-1')]);
    const modifier = skyEffect().modifiers[0]!;
    expect(applyFileToEffect(s, 'fx-1', deviceFile({ device: 'modifier', modifier }, {}).text, ctx()).section.effects[0]!.modifiers).toHaveLength(1);
    const cell = applyFileToEffect(s, 'fx-1', cellFile(kickHead, [solid('a')], {}).text, ctx());
    expect(cell.result).toEqual({ ok: false, reason: 'That file holds a cell, not an Effect or a device.' });
  });
});

describe('effect files — default minters', () => {
  it('without injected minters, ids are still unique within the section', () => {
    const text = cellFile(kickHead, [skyEffect(), skyEffect()], sources).text;
    const out = applyCellFile(section([solid('fx-src')]), kickHead, text, { canvasScenes: [scene('sky')] });
    const ids = out.section.effects.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const uids = out.section.effects.flatMap((e) => [...e.modifiers.map((m) => m.uid), ...e.controls.map((c) => c.uid)]);
    expect(new Set(uids).size).toBe(uids.length);
    // a saved file is a parseable ClipDoc
    expect(parse(text)).toMatchObject({ app: 'ledrums', kind: 'cell' });
  });
});
