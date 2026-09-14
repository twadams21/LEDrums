import { describe, expect, it, vi } from 'vitest';
import { createPixelResources, writePixelColors } from './pixel-resources';
import { DARK_PIXEL_RGB } from './dark-pixel';

describe('pixel resource ownership', () => {
  it('uploads exact RGB to every vertex, without modifying the transmitted frame', () => {
    const frame = new Uint8Array([255, 127, 9, 0, 0, 255]);
    const original = frame.slice();
    const colors = new Float32Array(2 * 12 * 3);
    writePixelColors(colors, frame, 2, 12);
    for (let i = 0; i < 2; i++) for (let v = 0; v < 12; v++) for (let c = 0; c < 3; c++) {
      expect(colors[(i * 12 + v) * 3 + c]).toBeCloseTo(frame[i * 3 + c]! / 255, 7);
    }
    expect(frame).toEqual(original);
    writePixelColors(colors, frame.subarray(0, 3), 2, 12);
    expect([...colors.subarray(36)]).toEqual(Array(36).fill(0));
    writePixelColors(colors, null, 2, 12);
    for (let i = 0; i < colors.length; i++) expect(colors[i]).toBeCloseTo(DARK_PIXEL_RGB[i % 3]!, 7);
  });
  it('retires each uploaded attribute set before replacing it, including an empty model', () => {
    const resources = createPixelResources();
    const retired: unknown[][] = [];
    const { geometry } = resources;
    expect(geometry.drawRange.count).toBe(0);
    geometry.addEventListener('dispose', () => {
      if (geometry.index) retired.push([geometry.getAttribute('position'), geometry.getAttribute('color'), geometry.index]);
    });
    const oldSets: unknown[][] = [];
    for (let i = 0; i < 3; i++) {
      resources.replace(new Float32Array([i, 0, 0]), new Float32Array([1, 0, 0]), new Uint32Array([0]));
      expect(geometry.drawRange.count).toBe(1);
      oldSets.push([geometry.getAttribute('position'), geometry.getAttribute('color'), geometry.index]);
    }
    expect(retired).toEqual(oldSets.slice(0, 2));
    resources.replace(new Float32Array(), new Float32Array(), new Uint32Array());
    expect(retired).toEqual(oldSets);
    expect(geometry.getAttribute('position')).toBeUndefined();
    expect(geometry.getAttribute('color')).toBeUndefined();
    expect(geometry.index).toBeNull();
    expect(geometry.boundingSphere).toBeNull();
    expect(geometry.drawRange.count).toBe(0);
    resources.dispose();
  });

  it('owns both material and geometry, disposes once on teardown and refuses reuse', () => {
    const resources = createPixelResources();
    const geometry = vi.spyOn(resources.geometry, 'dispose');
    const material = vi.spyOn(resources.material, 'dispose');
    resources.dispose();
    resources.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(() => resources.replace(new Float32Array(), new Float32Array(), new Uint32Array())).toThrow('already disposed');
  });
});
