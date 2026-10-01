import { describe, it, expect } from 'vitest';
import { effectChain, type CanvasScene } from '@ledrums/core';
import {
  buildCellClipDoc,
  buildDeviceClipDoc,
  buildEffectClipDoc,
  isClipParseError,
  parse,
  remapClipDoc,
  remapEffectsClipDoc,
  serialize,
  type CellClipDoc,
  type ClipDoc,
  type DeviceClipDoc,
  type EffectClipDoc,
} from './clipdoc';

const scene = (id: string, hue = 140): CanvasScene => ({
  id,
  name: 'Scene ' + id,
  tags: ['canvas'],
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue, sat: 1, softness: 0.08 }],
});

const sceneEffect = (id: string, sceneId: string): effectChain.Effect =>
  effectChain.parseEffect({
    id,
    name: 'Sky',
    cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
    generator: { kind: 'scene', style: 'scene', params: { sceneId, speed: 2 } },
    modifiers: [{ uid: 'm1', modifierId: 'strobe', params: { rate: 4 }, mix: 0.5 }],
    controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'm1', param: 'rate' }] }],
    blend: 'screen',
    opacity: 0.7,
  });

const spliceEffect = (id: string, sceneId: string): effectChain.Effect =>
  effectChain.parseEffect({
    id,
    cell: { row: 'kit', column: { kind: 'always' } },
    generator: {
      kind: 'splice',
      slots: [{ color: '#ff0000' }, { generator: { kind: 'scene', params: { sceneId } } }],
    },
  });

const roundTrip = (doc: ClipDoc): ClipDoc => {
  const parsed = parse(serialize(doc));
  if (isClipParseError(parsed)) throw new Error(parsed.message);
  return parsed;
};

describe('ClipDoc effect-chain kinds — build + parse round-trip', () => {
  it('an Effect round-trips with every authored field, carrying only the authored scenes it plays', () => {
    const effect = sceneEffect('fx-1', 'mine');
    const doc = buildEffectClipDoc(effect, { canvasScenes: [scene('mine'), scene('other')] });
    const back = roundTrip(doc) as EffectClipDoc;
    expect(back.kind).toBe('effect');
    expect(back.payload.effect).toEqual(effect);
    expect(back.deps.canvasScenes!.map((s) => s.id)).toEqual(['mine']);
  });

  it('an Effect playing a built-in scene carries no scene deps', () => {
    const builtin = effectChain.parseEffect({ id: 'fx', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'scene' } });
    expect(buildEffectClipDoc(builtin, { canvasScenes: [scene('mine')] }).deps.canvasScenes).toEqual([]);
  });

  it('a cell round-trips its whole stack in stack order and collects scenes from Splice slot Generators', () => {
    const stack = [spliceEffect('a', 'deep'), sceneEffect('b', 'mine')];
    const doc = buildCellClipDoc({ row: 'kit', column: { kind: 'always' } }, stack, { canvasScenes: [scene('mine'), scene('deep')] });
    const back = roundTrip(doc) as CellClipDoc;
    expect(back.payload.effects.map((e) => e.id)).toEqual(['a', 'b']);
    expect(back.payload.effects).toEqual(stack);
    expect(back.payload.cell).toEqual({ row: 'kit', column: { kind: 'always' } });
    expect(back.deps.canvasScenes!.map((s) => s.id).sort()).toEqual(['deep', 'mine']);
  });

  it('each device kind round-trips', () => {
    const effect = sceneEffect('fx', 'mine');
    const devices = [
      { device: 'generator' as const, generator: effect.generator },
      { device: 'modifier' as const, modifier: effect.modifiers[0]! },
      { device: 'control' as const, control: effect.controls[0]! },
    ];
    for (const device of devices) {
      const back = roundTrip(buildDeviceClipDoc(device, { canvasScenes: [scene('mine')] })) as DeviceClipDoc;
      expect(back.payload).toEqual(device);
      expect(back.deps.canvasScenes!.map((s) => s.id)).toEqual(device.device === 'generator' ? ['mine'] : []);
    }
  });

  it('a parsed Effect is defaulted by the core schema (a minimal hand-written file loads)', () => {
    const text = JSON.stringify({ app: 'ledrums', v: 2, kind: 'effect', payload: { effect: { id: 'x', cell: { row: 'snare', column: { kind: 'zone', slot: 1 } }, generator: { kind: 'solid' } } } });
    const doc = parse(text) as EffectClipDoc;
    expect(doc.payload.effect.trigger).toEqual({ kind: 'zone' });
    expect(doc.payload.effect.target).toEqual({ kind: 'select', drums: [{ drumId: 'snare' }] });
    expect(doc.payload.effect.opacity).toBe(1);
  });
});

describe('ClipDoc effect-chain kinds — defensive parse', () => {
  const envelope = (kind: string, payload: unknown, deps?: unknown): string => JSON.stringify({ app: 'ledrums', v: 2, kind, payload, deps });

  it('rejects an Effect that breaks the model invariants', () => {
    const bad = envelope('effect', { effect: { id: 'x', cell: { row: 'kit', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid' } } });
    const res = parse(bad);
    expect(isClipParseError(res) && res.reason).toBe('malformed');
  });

  it('a cell keeps the Effects that validate and drops the rest; an all-bad stack is malformed', () => {
    const good = { id: 'g', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'solid' } };
    const mixed = parse(envelope('cell', { cell: { row: 'kit', column: { kind: 'always' } }, effects: [good, { id: 'bad' }] })) as CellClipDoc;
    expect(mixed.payload.effects.map((e) => e.id)).toEqual(['g']);
    const allBad = parse(envelope('cell', { cell: { row: 'kit', column: { kind: 'always' } }, effects: [{ id: 'bad' }] }));
    expect(isClipParseError(allBad) && allBad.reason).toBe('malformed');
  });

  it('rejects an unknown device and a malformed one', () => {
    const unknown = parse(envelope('device', { device: 'sampler' }));
    expect(isClipParseError(unknown) && unknown.reason).toBe('malformed');
    const malformed = parse(envelope('device', { device: 'modifier', modifier: { uid: '' } }));
    expect(isClipParseError(malformed) && malformed.reason).toBe('malformed');
  });

  it('keeps only canvas scenes as deps, dropping id-less scenes and graph-model deps', () => {
    const text = envelope(
      'effect',
      { effect: { id: 'x', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'solid' } } },
      { graphs: { g: { nodes: [], edges: [] } }, effects: [{ id: 'e' }], canvasScenes: [scene('ok'), { name: 'no id' }] },
    );
    const doc = parse(text) as EffectClipDoc;
    expect(doc.deps).toEqual({ canvasScenes: [scene('ok')] });
  });

  it('the graph remapper refuses effect-chain docs rather than mis-materializing them', () => {
    const doc = buildEffectClipDoc(sceneEffect('fx', 'mine'), {});
    const res = remapClipDoc(doc, { graphs: {}, effects: [], presets: [], isBuiltInEffectId: () => false });
    expect(isClipParseError(res) && res.reason).toBe('unknown-kind');
  });
});

describe('remapEffectsClipDoc — canvas-scene dependency remap', () => {
  let n = 0;
  const mintScene = (): string => `new-scene-${++n}`;

  it('a scene new to the show gets a fresh id and every Scene Generator (incl. slots) follows it', () => {
    n = 0;
    const doc = buildCellClipDoc({ row: 'kit', column: { kind: 'always' } }, [spliceEffect('a', 'mine'), sceneEffect('b', 'mine')], { canvasScenes: [scene('mine')] });
    const { doc: local, canvasScenes } = remapEffectsClipDoc(doc, { canvasScenes: [scene('mine', 10)], mintScene });
    expect(canvasScenes).toEqual([{ ...scene('mine'), id: 'new-scene-1' }]);
    expect(local.payload.effects[0]!.generator.slots![1]!.generator!.params.sceneId).toBe('new-scene-1');
    expect(local.payload.effects[1]!.generator.params.sceneId).toBe('new-scene-1');
    // untouched params survive the rewrite
    expect(local.payload.effects[1]!.generator.params.speed).toBe(2);
  });

  it('a scene whose content already exists locally is reused by id, adding nothing', () => {
    const doc = buildEffectClipDoc(sceneEffect('fx', 'theirs'), { canvasScenes: [scene('theirs')] });
    const { doc: local, canvasScenes } = remapEffectsClipDoc(doc, { canvasScenes: [{ ...scene('theirs'), id: 'mine' }], mintScene });
    expect(canvasScenes).toEqual([]);
    expect(local.payload.effect.generator.params.sceneId).toBe('mine');
  });

  it('a built-in scene ref (not carried) stays verbatim; the input doc is not mutated', () => {
    const effect = effectChain.parseEffect({ id: 'fx', cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'scene', params: { sceneId: 'builtin-x' } } });
    const doc = buildEffectClipDoc(effect, {});
    const before = structuredClone(doc);
    const { doc: local } = remapEffectsClipDoc(doc, { canvasScenes: [], mintScene });
    expect(local.payload.effect.generator.params.sceneId).toBe('builtin-x');
    expect(doc).toEqual(before);
  });

  it('a generator device doc is remapped; a modifier doc passes through', () => {
    const effect = sceneEffect('fx', 'mine');
    const gen = remapEffectsClipDoc(buildDeviceClipDoc({ device: 'generator', generator: effect.generator }, { canvasScenes: [scene('mine')] }), { canvasScenes: [], mintScene: () => 'fresh' });
    expect(gen.doc.payload).toEqual({ device: 'generator', generator: { ...effect.generator, params: { sceneId: 'fresh', speed: 2 } } });
    const mod = remapEffectsClipDoc(buildDeviceClipDoc({ device: 'modifier', modifier: effect.modifiers[0]! }, {}), { mintScene });
    expect(mod.doc.payload).toEqual({ device: 'modifier', modifier: effect.modifiers[0] });
    expect(mod.canvasScenes).toEqual([]);
  });
});
