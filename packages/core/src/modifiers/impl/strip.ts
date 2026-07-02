/**
 * Shared 1D-strip helpers for the SPATIAL modifiers (Slide, Blur, Kaleidoscope, Chromatic).
 * A voice's pixel range is treated as a linear strip `[0, len)`; these map a local strip
 * position back to a GLOBAL framebuffer index (matching `fb`'s own indexing, no rebasing —
 * the trail.ts tracer rule) with either wrap or clamp edges, and snapshot the range so a
 * modifier can read a stable copy while it overwrites `fb` in place.
 *
 * The scratch buffer is model-sized (like Trail's accumulator) and lives in per-voice state,
 * so spatial modifiers reuse it every frame — no per-frame allocation on the modified path.
 */
import type { PixelModel } from '../../geometry/pixel-model';
import type { Framebuffer } from '../../engine/framebuffer';
import type { PixelRange } from '../types';

/** Pixel count of a range's strip. */
export function rangeLen(range: PixelRange): number {
  return range.end - range.start;
}

/** Per-voice scratch for spatial modifiers: a model-sized RGBA copy read while `fb` is rewritten. */
export interface ScratchState {
  scratch: Float32Array;
}

export function makeScratch(model: PixelModel): ScratchState {
  return { scratch: new Float32Array(model.pixelCount * 4) };
}

/** Copy the range's RGBA out of `fb` into `scratch` (same global indices as `fb`). */
export function snapshotRange(fb: Framebuffer, range: PixelRange, scratch: Float32Array): void {
  const src = fb.rgba;
  for (let i = range.start; i < range.end; i++) {
    const j = i * 4;
    scratch[j] = src[j]!;
    scratch[j + 1] = src[j + 1]!;
    scratch[j + 2] = src[j + 2]!;
    scratch[j + 3] = src[j + 3]!;
  }
}

/** Clamp a local strip position to `[0, len)` and return the GLOBAL pixel index. */
export function clampIndex(range: PixelRange, pos: number, len: number): number {
  const p = pos < 0 ? 0 : pos >= len ? len - 1 : pos;
  return range.start + p;
}

/** Wrap a local strip position into `[0, len)` (toroidal strip) → GLOBAL pixel index. */
export function wrapIndex(range: PixelRange, pos: number, len: number): number {
  let p = pos % len;
  if (p < 0) p += len;
  return range.start + p;
}
