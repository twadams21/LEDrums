import { compositeInto, type BlendMode } from '../color/blend';
import { Framebuffer } from './framebuffer';

export interface CompositeLayer {
  fb: Framebuffer;
  blendMode: BlendMode;
  opacity: number;
}

/**
 * Blend layer framebuffers bottom → top into the destination (plan KTD6). The dest
 * is cleared first; each layer composites its RGBA using its blend mode + opacity.
 */
export function composite(layers: CompositeLayer[], dst: Framebuffer): void {
  dst.clear();
  const n = dst.pixelCount;
  for (const layer of layers) {
    if (layer.opacity <= 0) continue;
    const src = layer.fb.rgba;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const sa = src[j + 3]!;
      if (sa <= 0) continue;
      compositeInto(dst.rgba, j, src[j]!, src[j + 1]!, src[j + 2]!, sa, layer.blendMode, layer.opacity);
    }
  }
}
