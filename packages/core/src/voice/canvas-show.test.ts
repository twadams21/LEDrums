import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { canvasEffectId } from '../canvas/ids';
import { tryGetCanvasScene } from '../canvas/registry';
import { tryGetEffect } from '../effects/registry';
import type { CanvasScene } from '../canvas/types';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { emptyShow, type Show } from './types';
import { sectionOf, songOf, zoneEffect } from './effect-test-fixtures';

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

function showWith(scenes: CanvasScene[], extra: Partial<Show> = {}): Show {
  return { ...emptyShow(), canvasScenes: scenes, ...extra };
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

  it('renders a Scene Effect without any compositor change', () => {
    const eng = createVoiceBusEngine();
    const model = testModel();
    eng.setModel(model);

    const s = scene('scene_c');
    const effect = zoneEffect('fx', { kind: 'scene', params: { sceneId: 'scene_c', brightness: 1 } }, {
      amp: { attackMs: 800, length: { ms: 800 }, releaseMs: 900 }, target: { kind: 'kit' },
    });
    eng.setShow(showWith([s], { songs: [songOf('song', [sectionOf('sec', [effect])])] }));

    const hit: InputEvent = { kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs: 0 };
    eng.applyInput(hit);
    eng.tick(5, 5, transport(5));
    eng.tick(40, 35, transport(40));
    expect(eng.frame().length).toBe(model.pixelCount * 4);
    expect(eng.stats().voiceCount).toBeGreaterThan(0);
  });
});
