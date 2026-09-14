import { describe, expect, it } from 'vitest';
import { visiblePixelIndices } from './pixel-visibility';
import { writePixelColors } from './pixel-resources';
import { kitModel } from './testing/model';
import { referenceKit } from './testing/stage-asset';

it('returns the exact original index buffer in diagnostic Pixels (including explicit empty exclusion)', () => {
  const model = kitModel(), index = new Uint32Array(model.count * 48);
  expect(visiblePixelIndices(index, model, 48)).toBe(index);
  expect(visiblePixelIndices(index, model, 48, new Set())).toBe(index);
});

describe('mixed Stage/Pixels presentation', () => {
  it('removes matching drum triangles without shifting any surviving pixel vertices or frame addresses', () => {
    const model = kitModel(referenceKit());
    const index = Uint32Array.from({ length: model.count * 48 }, (_, i) => i);
    const excluded = new Set(['kick', 'tom1']);
    const visible = visiblePixelIndices(index, model, 48, excluded);
    const expected = model.drums.filter((drum) => !excluded.has(drum.id)).flatMap((drum) => [...index.slice(drum.pixelStart * 48, (drum.pixelStart + drum.pixelCount) * 48)]);
    expect([...visible]).toEqual(expected);
    expect([...index]).toEqual(Array.from({ length: index.length }, (_, i) => i));
    const colors = new Float32Array(model.count * 12 * 3);
    const frame = Uint8Array.from({ length: model.count * 3 }, (_, i) => i % 255);
    writePixelColors(colors, frame, model.count, 12);
    for (const drum of model.drums.filter((drum) => !excluded.has(drum.id))) for (let c = 0; c < 3; c++) {
      expect(colors[drum.pixelStart * 12 * 3 + c]).toBeCloseTo(frame[drum.pixelStart * 3 + c]! / 255);
    }
  });
});
