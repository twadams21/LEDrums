import type { SerializedModel } from '../ws/protocol-types';

/** Cold Stage-only visibility mask. Vertex positions, original pixel offsets and RGB stay
 * untouched; Pixels' ordinary path returns the exact original index buffer. */
export function visiblePixelIndices(index: Uint32Array, model: SerializedModel, indicesPerPixel: number, exclude?: ReadonlySet<string>): Uint32Array {
  if (!exclude?.size) return index;
  const visible = new Uint8Array(model.count).fill(1);
  for (const drum of model.drums) {
    if (exclude.has(drum.id)) visible.fill(0, drum.pixelStart, drum.pixelStart + drum.pixelCount);
  }
  const result = new Uint32Array(visible.reduce((sum, bit) => sum + bit, 0) * indicesPerPixel);
  let offset = 0;
  for (let pixel = 0; pixel < model.count; pixel++) {
    if (!visible[pixel]) continue;
    result.set(index.subarray(pixel * indicesPerPixel, (pixel + 1) * indicesPerPixel), offset);
    offset += indicesPerPixel;
  }
  return result;
}
