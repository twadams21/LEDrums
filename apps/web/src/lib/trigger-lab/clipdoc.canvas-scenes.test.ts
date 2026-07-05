import { describe, it, expect } from 'vitest';
import type { CanvasScene } from '@ledrums/core';
import {
  buildGraphClipDoc,
  buildSectionClipDoc,
  remapClipDoc,
  type RemapContext,
  type RemapMint,
} from './clipdoc';
import type { ClosureSources } from './store/song-library';
import { makeNode } from './sim.graph-compilation';
import type { TriggerGraph } from './sim';
import { makeSection } from '../app/setlist';

const scene = (id: string, name = 'Scene ' + id): CanvasScene => ({
  id,
  name,
  tags: ['canvas'],
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue: 140, sat: 1, softness: 0.08 }],
});

const canvasGraph = (sceneId: string): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger', 0, 0),
    makeNode('play', 'p1', 0, 0, {
      kind: 'play',
      playType: 'canvas',
      canvasScene: sceneId,
      effectId: `canvas:${sceneId}`,
      presetId: `canvas:${sceneId}:default`,
    }),
  ],
  edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
});

function sources(over: Partial<ClosureSources> = {}): ClosureSources {
  return { graphs: {}, graphNames: {}, effects: [], presets: [], ...over };
}

function ctx(over: Partial<RemapContext> = {}): RemapContext {
  return { graphs: {}, effects: [], presets: [], canvasScenes: [], isBuiltInEffectId: () => false, ...over };
}

function testMint(): RemapMint {
  let g = 0;
  let sc = 0;
  return {
    graph: () => `tg-${++g}`,
    effect: () => `te-0`,
    preset: () => `tp-0`,
    section: () => `ts-0`,
    song: () => `tso-0`,
    scene: () => `tsc-${++sc}`,
  };
}

describe('ClipDoc canvas scene closure', () => {
  it('graph copy carries the referenced scene as a dep', () => {
    const s = scene('scene_a');
    const doc = buildGraphClipDoc('g1', sources({ graphs: { g1: canvasGraph('scene_a') }, canvasScenes: [s] }));
    expect(doc.deps.canvasScenes?.map((x) => x.id)).toEqual(['scene_a']);
  });

  it('paste remaps the scene id and rewrites canvasScene + effect/preset ids', () => {
    const s = scene('scene_a');
    const doc = buildGraphClipDoc('g1', sources({ graphs: { g1: canvasGraph('scene_a') }, canvasScenes: [s] }));
    const res = remapClipDoc(doc, ctx({ mint: testMint() }));
    if ('reason' in res) throw new Error('unexpected parse error');
    expect(res.canvasScenes.map((x) => x.id)).toEqual(['tsc-1']);
    const key = res.graphKey!;
    const node = res.graphs[key]!.nodes.find((n) => n.id === 'p1')!;
    expect(node.canvasScene).toBe('tsc-1');
    expect(node.effectId).toBe('canvas:tsc-1');
    expect(node.presetId).toBe('canvas:tsc-1:default');
  });

  it('reuses a content-identical local scene (no duplicate)', () => {
    const s = scene('scene_a');
    const doc = buildGraphClipDoc('g1', sources({ graphs: { g1: canvasGraph('scene_a') }, canvasScenes: [s] }));
    // local show already has the same scene content under a different id
    const local: CanvasScene = { ...scene('local_x'), name: s.name };
    // make content identical (id stripped in compare)
    const res = remapClipDoc(doc, ctx({ canvasScenes: [{ ...s, id: 'local_x' }], mint: testMint() }));
    if ('reason' in res) throw new Error('unexpected parse error');
    expect(res.canvasScenes).toHaveLength(0); // reused, none emitted
    const node = res.graphs[res.graphKey!]!.nodes.find((n) => n.id === 'p1')!;
    expect(node.canvasScene).toBe('local_x');
    void local;
  });

  it('section copy dedupes scenes across its graphs', () => {
    const section = makeSection('sec1', 'Sec', ['g1', 'g2']);
    const doc = buildSectionClipDoc(
      section,
      sources({
        graphs: { g1: canvasGraph('scene_a'), g2: canvasGraph('scene_a') },
        graphNames: {},
        canvasScenes: [scene('scene_a')],
      }),
    );
    expect(doc.deps.canvasScenes?.map((x) => x.id)).toEqual(['scene_a']);
  });
});
