import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';
import { DARK_PIXEL_RGB } from './dark-pixel';

/** Read-only RGB upload, shared by both presentations. Retired/short frames clear stale LEDs. */
export function writePixelColors(colors: Float32Array, frame: Uint8Array | null, count: number, verticesPerPixel: number): void {
  for (let i = 0; i < count; i++) {
    const r = frame ? (frame[i * 3] ?? 0) / 255 : DARK_PIXEL_RGB[0];
    const g = frame ? (frame[i * 3 + 1] ?? 0) / 255 : DARK_PIXEL_RGB[1];
    const b = frame ? (frame[i * 3 + 2] ?? 0) / 255 : DARK_PIXEL_RGB[2];
    for (let k = 0; k < verticesPerPixel; k++) {
      const offset = (i * verticesPerPixel + k) * 3;
      colors[offset] = r;
      colors[offset + 1] = g;
      colors[offset + 2] = b;
    }
  }
}

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
