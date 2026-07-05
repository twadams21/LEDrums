import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { canvasEffectId } from '../canvas/ids';
import { tryGetCanvasScene } from '../canvas/registry';
import { tryGetEffect } from '../effects/registry';
import type { CanvasScene } from '../canvas/types';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { emptyShow, padKey, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function scene(id: string, name = 'Scene'): CanvasScene {
  return {
    id,
    name,
    description: 'test',
    tags: ['canvas'],
    sampler: { kind: 'cylinder' },
    lenses: [],
    elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue: 140, sat: 1, softness: 0.08 }],
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
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

function showWith(scenes: CanvasScene[], extra: Partial<Show> = {}): Show {
  return { ...emptyShow(), buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }], canvasScenes: scenes, ...extra };
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

describe('canvas scene show registration', () => {
  it('registers scene docs on setShow so canvas:<id> resolves', () => {
    const eng = createVoiceBusEngine();
    eng.setModel(testModel());
    eng.setShow(showWith([scene('scene_a')]));

    expect(tryGetCanvasScene('scene_a')).toBeDefined();
    const gen = tryGetEffect(canvasEffectId('scene_a'));
    expect(gen).toBeDefined();
    expect(gen?.id).toBe('canvas:scene_a');
  });

  it('unregisters stale scene ids when the show is replaced', () => {
    const eng = createVoiceBusEngine();
    eng.setModel(testModel());
    eng.setShow(showWith([scene('scene_a'), scene('scene_b')]));
    expect(tryGetCanvasScene('scene_a')).toBeDefined();
    expect(tryGetCanvasScene('scene_b')).toBeDefined();

    eng.setShow(showWith([scene('scene_b')]));
    expect(tryGetCanvasScene('scene_a')).toBeUndefined();
    expect(tryGetCanvasScene('scene_b')).toBeDefined();
  });

  it('renders a canvas play graph without any compositor change', () => {
    const eng = createVoiceBusEngine();
    const model = testModel();
    eng.setModel(model);

    const s = scene('scene_c');
    const effId = canvasEffectId('scene_c');
    const canvasEffect: EffectDef = {
      id: effId,
      name: s.name,
      generatorId: effId,
      busId: 'base',
      scope: 'kit',
      params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
      attackMs: 800,
      sustainMs: 0,
      releaseMs: 900,
    };
    const graph: TriggerGraph = {
      nodes: [
        node('trigger', 'trig'),
        node('play', 'n1', { playType: 'canvas', canvasScene: 'scene_c', effectId: effId, presetId: `${effId}:default`, params: { brightness: 1 } }),
      ],
      edges: [{ id: 'e0', from: 'trig', to: 'n1' }],
    };
    eng.setShow(showWith([s], { effects: [canvasEffect], graphs: { [padKey('kick', '')]: graph } }));

    const hit: InputEvent = { kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs: 0 };
    eng.applyInput(hit);
    eng.tick(5, 5, transport(5));
    eng.tick(40, 35, transport(40));
    expect(eng.frame().length).toBe(model.pixelCount * 4);
    expect(eng.stats().voiceCount).toBeGreaterThan(0);
  });
});
