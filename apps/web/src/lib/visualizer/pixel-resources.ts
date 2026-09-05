import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';

/** Owns uploaded pixel buffers and their material across rebuilds and component teardown. */
export function createPixelResources() {
  const geometry = new BufferGeometry();
  geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
  });
  let disposed = false;

  return {
    geometry,
    material,
    replace(positions: Float32Array, colors: Float32Array, index: Uint32Array): void {
      if (disposed) throw new Error('Pixel resources already disposed');
      // Three deletes GPU buffers by reading the geometry's CURRENT attributes on dispose.
      // Disposing after setAttribute would lose the old buffers permanently.
      geometry.dispose();
      geometry.setDrawRange(0, positions.length === 0 ? 0 : index.length);
      if (positions.length === 0) {
        geometry.setIndex(null);
        geometry.deleteAttribute('position');
        geometry.deleteAttribute('color');
        geometry.boundingSphere = null;
        return;
      }
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
      geometry.setIndex(new BufferAttribute(index, 1));
      geometry.computeBoundingSphere();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
