import { describe, expect, it, vi } from 'vitest';
import { createPixelResources } from './pixel-resources';

describe('pixel resource ownership', () => {
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
