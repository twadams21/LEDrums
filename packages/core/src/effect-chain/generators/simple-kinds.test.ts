/* Effect chains wave 2 "gen-simple" — the Solid, Gradient, Meter, Lightning and Scene
   Generators. Each Style must render exactly what its underlying implementation renders at
   default params, through the same resolution the engine uses (`effectPlayAction`). */
import { describe, expect, it } from 'vitest';
import { canvasEffectId } from '../../canvas/ids';
import { Framebuffer } from '../../engine/framebuffer';
import type { RenderContext, TransportState } from '../../engine/render-context';
import { parseKit } from '../../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../../geometry/pixel-model';
import { getEffect } from '../../effects/registry';
import { defaultParams, type ResolvedParams } from '../../effects/types';
import { createVoiceBusEngine } from '../../voice/engine';
import { emptyShow, type Show } from '../../voice/types';
import { effectPlayAction } from '../resolver';
import { chainEffectDefId } from '../runtime';
import { parseEffect, type GeneratorDeviceInput } from '../types';
import { generatorParamSpec, getGeneratorDef, listGenerators, resolveGenerator } from './index';

/** Spec "Style mapping" for this piece's kinds. follow-hoop is merged into Solid → Simple. */
const EXPECTED: Record<string, readonly string[]> = {
  solid: ['solid-colour', 'solid-base', 'whole-drum', 'whole-kit', 'breathing-kit'],
  gradient: ['rainbow-flow', 'hue-rotate-kit', 'temp-sweep'],
  meter: ['meter-eq', 'swing'],
  lightning: ['lightning', 'spark-arc'],
};

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 3, defaultHoopSpacingMm: 50 },
    drums: ['kick', 'snare', 'tom'].map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

function transport(timeMs: number): TransportState {
  const beat = timeMs / 500;
  return { timeMs, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

/** Render `effectId` with `params` over frames spanning a kick hit (560 ms reaches spark-arc's landing); the frames concatenated. */
function renderFrames(effectId: string, params: ResolvedParams, m: PixelModel): number[] {
  const effect = getEffect(effectId);
  const state = effect.createState ? effect.createState(m, 7) : undefined;
  const out: number[] = [];
  let prev = 0;
  for (const t of [0, 40, 160, 560]) {
    const ctx: RenderContext = {
      model: m, timeMs: t, dt: t - prev, transport: transport(t),
      triggers: [{ seq: 1, drumId: 'kick', note: 36, velocity: 1, ageMs: t, timeMs: 0 }],
    };
    const fb = new Framebuffer(m.pixelCount);
    effect.render(ctx, params, fb, state);
    out.push(...fb.rgba);
    prev = t;
  }
  return out;
}

const fireCtx = { velocity: 1, sourceDrumId: 'kick', bpm: 120, layerOrder: 0 };

function playAction(generator: GeneratorDeviceInput) {
  return effectPlayAction(parseEffect({ id: 'e', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator }), fireCtx);
}

describe('Style coverage', () => {
  it.each(Object.entries(EXPECTED))('%s has exactly one Style per mapped effect', (kind, effectIds) => {
    const styles = getGeneratorDef(kind)!.styles;
    expect(styles.map((s) => s.effectId).sort()).toEqual([...effectIds].sort());
    expect(new Set(styles.map((s) => s.id)).size).toBe(styles.length);
  });

  it('no effect is reachable through two Styles, and follow-hoop has no Style of its own', () => {
    const all = listGenerators().flatMap((g) => g.styles.map((s) => s.effectId));
    expect(all.length).toBe(new Set(all).size);
    expect(all).not.toContain('follow-hoop');
  });

  it('lists every piece kind with a label, description and icon', () => {
    const listed = new Map(listGenerators().map((g) => [g.id, g]));
    for (const kind of [...Object.keys(EXPECTED), 'scene']) {
      const def = listed.get(kind as never);
      expect(def, kind).toBeDefined();
      expect(def!.label && def!.description && def!.icon, kind).toBeTruthy();
    }
  });

  it('keeps the Solid defaults the S01 contract relies on: Solid first, Simple = whole-drum', () => {
    expect(resolveGenerator({ kind: 'solid', style: '', params: {} })?.effectId).toBe('solid-colour');
    expect(resolveGenerator({ kind: 'solid', style: 'simple', params: {} })?.effectId).toBe('whole-drum');
  });
});

describe('each Style renders its underlying implementation at default params', () => {
  const m = model();
  const cases = Object.keys(EXPECTED).flatMap((kind) =>
    getGeneratorDef(kind)!.styles.map((s) => [kind, s.id, s.effectId] as const));

  it.each(cases)('%s / %s ≡ %s', (kind, style, effectId) => {
    const action = playAction({ kind: kind as GeneratorDeviceInput['kind'], style })!;
    expect(action.effectId).toBe(chainEffectDefId(effectId));
    const direct = renderFrames(effectId, defaultParams(getEffect(effectId).paramSpec), m);
    expect(direct.some((v) => v > 0), 'oracle lights something').toBe(true);
    expect(renderFrames(effectId, action.params, m)).toEqual(direct);
  });
});

describe('generatorParamSpec', () => {
  it('shows the full underlying spec, with common hue params labelled "Hue"', () => {
    const keys = (kind: string, style: string) => generatorParamSpec(kind, style).map((p) => p.key);
    expect(keys('meter', 'swing')).toEqual(getEffect('swing').paramSpec.map((p) => p.key));
    const label = (kind: string, style: string, key: string) =>
      generatorParamSpec(kind, style).find((p) => p.key === key)?.label;
    expect(label('gradient', 'rainbow', 'hueOffset')).toBe('Hue');
    expect(label('gradient', 'hue-rotate', 'baseHue')).toBe('Hue');
    expect(label('lightning', 'bolt', 'hue')).toBe('Hue');
  });

  it('gives the Scene card the standard canvas scene params', () => {
    expect(generatorParamSpec('scene', '').map((p) => p.key))
      .toEqual(getEffect(canvasEffectId('stripe-band')).paramSpec.map((p) => p.key));
  });

  it('is empty for an unknown Style', () => {
    expect(generatorParamSpec('solid', 'nope')).toEqual([]);
  });
});

describe('Scene', () => {
  const m = model();

  it('plays the picked canvas scene as canvas:<sceneId>, the picker param consumed', () => {
    const action = playAction({ kind: 'scene', params: { sceneId: 'tunnel-rings', speed: 2 } })!;
    expect(action.canvasScene).toBe('tunnel-rings');
    expect(action.effectId).toBe(chainEffectDefId(canvasEffectId('tunnel-rings')));
    expect(action.params).not.toHaveProperty('sceneId');
    expect(action.params.speed).toBe(2);
  });

  it('defaults to the first built-in scene, rendering it exactly at default params', () => {
    const id = canvasEffectId('stripe-band');
    const action = playAction({ kind: 'scene' })!;
    expect(action.canvasScene).toBe('stripe-band');
    const direct = renderFrames(id, defaultParams(getEffect(id).paramSpec), m);
    expect(direct.some((v) => v > 0)).toBe(true);
    expect(renderFrames(id, action.params, m)).toEqual(direct);
  });

  it('resolves an unregistered scene or an unknown Style to null without throwing', () => {
    expect(resolveGenerator({ kind: 'scene', style: '', params: { sceneId: 'no-such-scene' } })).toBeNull();
    expect(resolveGenerator({ kind: 'scene', style: 'nope', params: {} })).toBeNull();
    expect(playAction({ kind: 'scene', params: { sceneId: 'no-such-scene' } })).toBeNull();
  });

  it('lights the kit through the engine when a zone fires a Scene Effect', () => {
    const effect = parseEffect({
      id: 's', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, target: { kind: 'kit' },
      generator: { kind: 'scene', params: { sceneId: 'checker-spin' } },
      amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 100 },
    });
    const show: Show = { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections: [{ id: 'A', name: 'A', slots: {}, effects: [effect] }] }] };
    const engine = createVoiceBusEngine();
    engine.setModel(m);
    engine.setShow(show);
    engine.tick(0, 0, transport(0));
    engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1, timeMs: 0 });
    for (let t = 10; t <= 100; t += 10) engine.tick(t, 10, transport(t));
    expect(engine.frame().some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
  });
});
