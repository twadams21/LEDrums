import { describe, expect, it } from 'vitest';
import type { CanvasScene } from '@ledrums/core';
import { coerceAuthored } from './persistence';

const scene = (id: string): CanvasScene => ({
  id,
  name: 'Scene',
  tags: ['canvas'],
  sampler: { kind: 'cylinder' },
  lenses: [],
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0.2, hue: 140, sat: 1, softness: 0.08 }],
});

describe('canvasScenes persistence', () => {
  it('round-trips canvasScenes through coerceAuthored', () => {
    const out = coerceAuthored({ canvasScenes: [scene('scene_a'), scene('scene_b')] });
    expect(out.canvasScenes?.map((s) => s.id)).toEqual(['scene_a', 'scene_b']);
  });

  it('tolerates a missing canvasScenes field', () => {
    const out = coerceAuthored({ bpm: 120 });
    expect(out.canvasScenes).toBeUndefined();
    expect(out.bpm).toBe(120);
  });

  it('ignores a non-array canvasScenes field', () => {
    const out = coerceAuthored({ canvasScenes: { bad: true } });
    expect(out.canvasScenes).toBeUndefined();
  });
});
