import { describe, expect, it } from 'vitest';
import { formatCanvasScene, makeCanvasScene, parseCanvasSceneJson } from './canvas-scenes';

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
