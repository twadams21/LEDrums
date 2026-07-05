import { describe, expect, it } from 'vitest';
import { CANVAS_PARAM_SPEC, type CanvasScene } from '@ledrums/core';
import type { GraphNode, TriggerGraph } from '../sim';
import {
  canvasDefaultPreset,
  canvasEffectDef,
  formatCanvasScene,
  makeCanvasScene,
  parseCanvasSceneJson,
  retargetSceneRefs,
  sceneRefsInGraph,
} from './canvas-scenes';

function playNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: 'play',
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
  } as GraphNode;
}

function graphWith(...nodes: GraphNode[]): TriggerGraph {
  return { nodes, edges: [] };
}

describe('canvasEffectDef', () => {
  it('projects a scene into a canvas-typed virtual effect', () => {
    const scene = makeCanvasScene('scene_a', 'Aurora');
    const eff = canvasEffectDef(scene);
    expect(eff.id).toBe('canvas:scene_a');
    expect(eff.generatorId).toBe('canvas:scene_a');
    expect(eff.playType).toBe('canvas');
    expect(eff.tags).toContain('canvas');
    expect(eff.params.map((p) => p.key)).toEqual(CANVAS_PARAM_SPEC.map((p) => p.key));
  });

  it('default preset id is <effectId>:default with spec defaults', () => {
    const preset = canvasDefaultPreset(makeCanvasScene('scene_a'));
    expect(preset.id).toBe('canvas:scene_a:default');
    expect(preset.effectId).toBe('canvas:scene_a');
    expect(preset.params.brightness).toBe(1);
  });
});

describe('parseCanvasSceneJson', () => {
  const base = makeCanvasScene('scene_a', 'Aurora');

  it('accepts a valid scene', () => {
    const res = parseCanvasSceneJson('scene_a', formatCanvasScene(base));
    expect(res.ok).toBe(true);
  });

  it('rejects a changed id', () => {
    const mutated = JSON.stringify({ ...base, id: 'scene_b' });
    const res = parseCanvasSceneJson('scene_a', mutated);
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects missing elements', () => {
    const { elements, ...noElements } = base;
    const res = parseCanvasSceneJson('scene_a', JSON.stringify(noElements));
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects missing sampler', () => {
    const { sampler, ...noSampler } = base;
    const res = parseCanvasSceneJson('scene_a', JSON.stringify(noSampler));
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects malformed JSON', () => {
    expect(parseCanvasSceneJson('scene_a', '{not json')).toMatchObject({ ok: false });
  });
});

describe('sceneRefsInGraph', () => {
  it('collects scene ids from canvasScene and canvas effect ids', () => {
    const g = graphWith(
      playNode('a', { canvasScene: 'scene_a' }),
      playNode('b', { effectId: 'canvas:scene_b' }),
      playNode('c', { effectId: 'solid-base' }),
    );
    expect(sceneRefsInGraph(g).sort()).toEqual(['scene_a', 'scene_b']);
  });
});

describe('retargetSceneRefs', () => {
  const sceneB: CanvasScene = makeCanvasScene('scene_b', 'B');

  it('retargets nodes to the fallback scene', () => {
    const graphs = { g1: graphWith(playNode('a', { canvasScene: 'scene_a', effectId: 'canvas:scene_a' })) };
    const out = retargetSceneRefs(graphs, 'scene_a', sceneB);
    const node = out.g1!.nodes[0]!;
    expect(node.canvasScene).toBe('scene_b');
    expect(node.effectId).toBe('canvas:scene_b');
    expect(node.presetId).toBe('canvas:scene_b:default');
  });

  it('clears the canvas binding when there is no fallback', () => {
    const graphs = { g1: graphWith(playNode('a', { canvasScene: 'scene_a', effectId: 'canvas:scene_a' })) };
    const out = retargetSceneRefs(graphs, 'scene_a', null);
    const node = out.g1!.nodes[0]!;
    expect(node.canvasScene).toBeUndefined();
    expect(node.effectId).toBe('');
    expect(node.playType).toBe('canvas');
  });

  it('leaves unrelated graphs untouched (same reference)', () => {
    const other = graphWith(playNode('x', { effectId: 'solid-base' }));
    const graphs = { g1: other };
    const out = retargetSceneRefs(graphs, 'scene_a', sceneB);
    expect(out.g1).toBe(other);
  });
});
