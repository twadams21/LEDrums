import { clamp01 } from '../math';

/**
 * A flat RGBA float buffer (stride 4) indexed by pixel id. Effects render into one
 * of these per layer; the compositor blends them into the final frame (plan KTD6).
 */
export class Framebuffer {
  readonly rgba: Float32Array;
  readonly pixelCount: number;

  constructor(pixelCount: number) {
    this.pixelCount = pixelCount;
    this.rgba = new Float32Array(pixelCount * 4);
  }

  clear(): void {
    this.rgba.fill(0);
  }

  /** Replace a pixel's color (alpha defaults to 1 = fully covered). */
  set(id: number, r: number, g: number, b: number, a = 1): void {
    const i = id * 4;
    this.rgba[i] = r;
    this.rgba[i + 1] = g;
    this.rgba[i + 2] = b;
    this.rgba[i + 3] = a;
  }

  /** Additively accumulate into a pixel, clamped, raising coverage. */
  add(id: number, r: number, g: number, b: number, a = 1): void {
    const i = id * 4;
    this.rgba[i] = clamp01(this.rgba[i]! + r);
    this.rgba[i + 1] = clamp01(this.rgba[i + 1]! + g);
    this.rgba[i + 2] = clamp01(this.rgba[i + 2]! + b);
    this.rgba[i + 3] = clamp01(this.rgba[i + 3]! + a);
  }

  /** Max-merge into a pixel (useful for overlapping trigger effects). */
  max(id: number, r: number, g: number, b: number, a = 1): void {
    const i = id * 4;
    this.rgba[i] = Math.max(this.rgba[i]!, r);
    this.rgba[i + 1] = Math.max(this.rgba[i + 1]!, g);
    this.rgba[i + 2] = Math.max(this.rgba[i + 2]!, b);
    this.rgba[i + 3] = Math.max(this.rgba[i + 3]!, a);
  }
}
