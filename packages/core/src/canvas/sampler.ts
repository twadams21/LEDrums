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
import { clamp01, DEG2RAD } from '../math';
import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import type { SamplerConfig } from './types';

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

// ---- Scene placement samplers (D4) ------------------------------------------------

/**
 * Per-pixel base canvas coordinates under one {@link SamplerConfig} — the STATIC part
 * of a scene's geometry→canvas placement, precomputed once per (model, config) and
 * cached by the scene adapter's state. Per-frame dynamics (samplerRotDeg, canvas
 * offset/scale/rotation, lenses) transform these values without rebuilding the table.
 */
export interface SamplerTable {
  u: Float32Array;
  v: Float32Array;
}

/** Total hoops across the model, in drum build order — the auto-grid cell count. */
function totalHoops(model: PixelModel): number {
  let n = 0;
  for (const d of model.drums) n += d.hoopCount;
  return n;
}

/**
 * Build the per-pixel (u,v) table for a sampler config. Pure function of its inputs;
 * everything derives from existing `Pixel` fields (uv, angleDeg, hoopIndex,
 * indexInHoop, world) + kit bounds — no new geometry.
 */
export function buildSamplerTable(model: PixelModel, config: SamplerConfig): SamplerTable {
  const n = model.pixelCount;
  const u = new Float32Array(n);
  const v = new Float32Array(n);

  switch (config.kind) {
    case 'hoop': {
      // Each (drum, hoop) is a circle on the canvas: explicit placements first, then an
      // auto grid (row-major square-ish) for the rest. A pixel samples at its hoop angle.
      const hoops = totalHoops(model);
      const cols = Math.max(1, Math.ceil(Math.sqrt(hoops)));
      const rows = Math.max(1, Math.ceil(hoops / cols));
      const cellW = 1 / cols;
      const cellH = 1 / rows;
      const autoR = config.radius ?? 0.4 * Math.min(cellW, cellH);
      let hoopBase = 0; // global hoop index of the current drum's hoop 0
      for (const d of model.drums) {
        for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) {
          const p = model.pixels[i]!;
          const g = hoopBase + (p.hoopIndex - 1); // hoopIndex is 1-based (A1); g stays a 0-based global hoop index
          const placed = config.placements?.[g];
          const cx = placed ? placed.cx : (g % cols) * cellW + cellW / 2;
          const cy = placed ? placed.cy : Math.floor(g / cols) * cellH + cellH / 2;
          const r = placed ? placed.r : autoR;
          const a = p.angleDeg * DEG2RAD;
          u[i] = cx + r * Math.cos(a);
          v[i] = cy + r * Math.sin(a);
        }
        hoopBase += d.hoopCount;
      }
      break;
    }
    case 'strip': {
      // The whole pixel chain unwound to a straight line: position along the line is the
      // pixel's build order (drum → hoop → indexInHoop, i.e. its arclength along the
      // chain), centred on the canvas, rotated by angleDeg, shifted by `offset`
      // perpendicular to the line.
      const a = (config.angleDeg ?? 0) * DEG2RAD;
      const span = config.span ?? 1;
      const off = config.offset ?? 0;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const denom = Math.max(1, n - 1);
      for (let i = 0; i < n; i++) {
        const s = (i / denom - 0.5) * span;
        u[i] = 0.5 + s * cosA - off * sinA;
        v[i] = 0.5 + s * sinA + off * cosA;
      }
      break;
    }
    case 'cylinder': {
      // Existing per-drum cylindrical uv → a canvas region (default: the full canvas).
      const rg = config.region ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
      for (let i = 0; i < n; i++) {
        const p = model.pixels[i]!;
        u[i] = rg.u0 + p.uv.u * (rg.u1 - rg.u0);
        v[i] = rg.v0 + p.uv.v * (rg.v1 - rg.v0);
      }
      break;
    }
    case 'footprint': {
      // Kit-wide planar projection — exactly the legacy planar-xz UvMode.
      for (let i = 0; i < n; i++) {
        const [pu, pv] = uvFor(i, model, 'planar-xz');
        u[i] = pu;
        v[i] = pv;
      }
      break;
    }
  }
  return { u, v };
}

/** True when the sampler places pixels by their WORLD position — the samplers the
    `hyper4d` lens is defined for first (it re-projects world space, D5). */
export function isWorldSpaceSampler(config: SamplerConfig): boolean {
  return config.kind === 'cylinder' || config.kind === 'footprint';
}
