import { describe, expect, it } from 'vitest';
import type { CanvasScene } from '@ledrums/core';
import { buildShow, type ShowSource } from './show-builder';
import { BUSES, DRUMS, PADS, PRESETS, SECTIONS, EFFECTS } from './fixtures';
import { treeToGraph } from './sim';
import { canvasEffectDef } from './store/canvas-scenes';

const scene = (id: string): CanvasScene => ({
  id,
  name: 'Scene ' + id,
  tags: ['canvas'],
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue: 140, sat: 1, softness: 0.08 }],
});

function sourceWith(scenes: CanvasScene[]): ShowSource {
  return {
    buses: BUSES.map((b) => ({ ...b })),
    graphs: Object.fromEntries(PADS.map((p) => [`${p.drumId}:${p.zone}`, treeToGraph(p.tree)])),
    sections: structuredClone(SECTIONS),
    effects: [...EFFECTS, ...scenes.map(canvasEffectDef)],
    presets: structuredClone(PRESETS),
    canvasScenes: scenes,
    drums: DRUMS.map((d) => ({ id: d.id })),
  };
}

describe('buildShow canvas scenes', () => {
  it('carries canvasScenes into the Show aggregate (deep-copied)', () => {
    const scenes = [scene('scene_a')];
    const show = buildShow(sourceWith(scenes));
    expect(show.canvasScenes?.map((s) => s.id)).toEqual(['scene_a']);
    expect(show.canvasScenes?.[0]).not.toBe(scenes[0]); // snapshot, not alias
  });

  it('includes canvas virtual effects supplied by the source', () => {
    const show = buildShow(sourceWith([scene('scene_a')]));
    expect(show.effects.some((e) => e.id === 'canvas:scene_a')).toBe(true);
  });

  it('preserves a canvasScene ref on a play node through structural assignment', () => {
    const src = sourceWith([scene('scene_a')]);
    const key = Object.keys(src.graphs)[0]!;
    src.graphs[key]!.nodes.push({
      id: 'canvasnode',
      kind: 'play',
      x: 0,
      y: 0,
      mode: 'oneshot',
      scope: 'kit',
      playType: 'canvas',
      canvasScene: 'scene_a',
      effectId: 'canvas:scene_a',
      presetId: 'canvas:scene_a:default',
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
    } as never);
    const show = buildShow(src);
    const node = show.graphs[key]!.nodes.find((n) => n.id === 'canvasnode');
    expect(node?.canvasScene).toBe('scene_a');
  });

  it('defaults canvasScenes to [] when the source omits them', () => {
    const src = sourceWith([]);
    delete src.canvasScenes;
    const show = buildShow(src);
    expect(show.canvasScenes).toEqual([]);
  });
});
