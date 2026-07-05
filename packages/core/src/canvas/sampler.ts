/**
 * Canvas samplers — how the kit's 3D pixel geometry lands on a 2D canvas (D4). This is
 * `effects/field.ts` grown up (locked decision 7): the legacy {@link UvMode} projections
 * (cylindrical / planar-*) live here as the seed sampler set, and {@link renderUvField}
 * remains the base every Gen-2 UV texture renders through. The scene engine's four
 * placement samplers (`hoop` / `strip` / `cylinder` / `footprint`) build on the same
 * pixel fields — no new geometry.
 *
 * Pure core module: no Node/DOM/IO; samplers are pure functions of (pixel, model, config).
 */
import { clamp01 } from '../math';
import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';

/**
 * How a pixel's (u,v) is derived for 2D texture/field effects:
 * - `cylindrical` — per drum: u = angle/360, v = hoop height (texture wraps each drum).
 * - `planar-*`    — project world position onto an axis-plane, normalized by kit bounds
 *                   (one texture spans the whole kit in space).
 */
export type UvMode = 'cylindrical' | 'planar-xy' | 'planar-xz' | 'planar-yz';

/** rgb in [0,1], or null to leave the pixel untouched (transparent). */
export type FieldSample = (u: number, v: number, tSec: number, ctx: RenderContext) => readonly [number, number, number] | null;

function norm(value: number, min: number, max: number): number {
  const span = max - min || 1;
  return clamp01((value - min) / span);
}

/** Compute the (u,v) for a pixel under a given mode. */
export function uvFor(pixelId: number, model: PixelModel, mode: UvMode): [number, number] {
  const p = model.pixels[pixelId]!;
  if (mode === 'cylindrical') return [p.uv.u, p.uv.v];
  const b = model.bounds;
  switch (mode) {
    case 'planar-xy':
      return [norm(p.world.x, b.min.x, b.max.x), norm(p.world.y, b.min.y, b.max.y)];
    case 'planar-xz':
      return [norm(p.world.x, b.min.x, b.max.x), norm(p.world.z, b.min.z, b.max.z)];
    case 'planar-yz':
      return [norm(p.world.y, b.min.y, b.max.y), norm(p.world.z, b.min.z, b.max.z)];
  }
}

/**
 * Render a 2D field across the kit: for every pixel, compute its (u,v) under `mode`,
 * sample the field, and write the color. This is the base for all 2D / "UV map"
 * effects — an effect just supplies a pure `(u,v,t) → rgb` function.
 */
export function renderUvField(ctx: RenderContext, fb: Framebuffer, mode: UvMode, sample: FieldSample): void {
  const t = ctx.timeMs / 1000;
  for (const p of ctx.model.pixels) {
    const [u, v] = mode === 'cylindrical' ? [p.uv.u, p.uv.v] : uvFor(p.id, ctx.model, mode);
    const c = sample(u, v, t, ctx);
    if (c) fb.set(p.id, c[0], c[1], c[2], 1);
  }
}
